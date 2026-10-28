/**
 * AI单据识别云函数
 * 调用Kimi API识别进仓通知单
 * 此文件修改不会影响历史数据
 */

const cloud = require('wx-server-sdk');
const { assertCallerAccess } = require('./revoked-access');
const axios = require('axios');
const config = require('./config');
const { parseAIResponse, normalizeShipmentData } = require('./utils/aiParser');
const { success, error } = require('./utils/response');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

function isRetryableAIError(err) {
  const status = err.response?.status;
  const data = err.response?.data || {};
  const type = data.error?.type || data.type || '';
  const message = data.error?.message || data.message || err.message || '';

  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    type.includes('overloaded') ||
    /overloaded|timeout|ECONNRESET|ETIMEDOUT|socket hang up/i.test(message)
  );
}

function getFriendlyAIError(err) {
  const status = err.response?.status;
  const data = err.response?.data || {};
  const type = data.error?.type || data.type || '';
  const message = data.error?.message || data.message || err.message || '';

  if (status === 429 || type.includes('overloaded') || /overloaded/i.test(message)) {
    return 'AI服务当前繁忙，请稍后再试';
  }
  if (/timeout|ETIMEDOUT/i.test(message)) {
    return 'AI识别超时，请稍后重试或换一张更清晰的图片';
  }
  return 'AI识别失败，请稍后重试或手动录入';
}

function getErrorDetail(err) {
  const data = err.response?.data;
  if (data?.error?.message) return data.error.message;
  if (data?.message) return data.message;
  if (data) return JSON.stringify(data).slice(0, 300);
  return err.message || '未知错误';
}

/**
 * 图片放大处理：短边小于阈值时等比放大
 * 让AI能看清进仓单上的小字
 */
async function resizeImageIfNeeded(buffer) {
  try {
    const Jimp = require('jimp');
    const image = await Jimp.read(buffer);
    const width = image.getWidth();
    const height = image.getHeight();
    const minSide = Math.min(width, height);
    const maxSide = Math.max(width, height);
    const targetMin = 1024; // 短边目标像素
    const targetMax = 1800; // 长边上限，避免base64过大导致超时

    if (minSide < targetMin) {
      const scale = targetMin / minSide;
      image.scale(scale, Jimp.RESIZE_BILINEAR);
      console.log(`图片已放大: ${width}x${height} -> ${image.getWidth()}x${image.getHeight()}, scale=${scale.toFixed(2)}`);
    } else if (maxSide > targetMax) {
      const scale = targetMax / maxSide;
      image.scale(scale, Jimp.RESIZE_BILINEAR);
      console.log(`图片已压缩: ${width}x${height} -> ${image.getWidth()}x${image.getHeight()}, scale=${scale.toFixed(2)}`);
    } else {
      console.log(`图片尺寸足够: ${width}x${height}, 无需放大`);
    }

    // 统一转为JPEG，控制质量避免base64过大
    return await image.quality(82).getBufferAsync(Jimp.MIME_JPEG);
  } catch (err) {
    console.error('图片处理失败，使用原图:', err.message);
    return buffer;
  }
}

async function buildImageDataUrl(imageUrl) {
  // 下载图片（Kimi不支持微信云存储的签名URL，统一转base64）
  const imageRes = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 10000 });
  // 放大图片：短边小于1024时等比放大，让AI看清文字
  const processedBuffer = await resizeImageIfNeeded(Buffer.from(imageRes.data, 'binary'));
  const base64Image = processedBuffer.toString('base64');
  const originalMimeType = imageRes.headers['content-type'] || 'image/jpeg';
  const mimeType = originalMimeType.includes('pdf') ? originalMimeType : 'image/jpeg';
  return `data:${mimeType};base64,${base64Image}`;
}

/**
 * 调用Kimi API进行图片识别
 * 可在config/index.js中修改prompt来优化识别效果
 */
async function callKimiAPI(dataUrl) {
  const { apiKey, baseUrl, model, fallbackModels = [], prompt, timeout } = config.kimi;

  if (!apiKey) {
    throw new Error('Kimi API Key未配置，请在云函数环境变量中设置KIMI_API_KEY');
  }

  const models = [model, ...fallbackModels].filter(Boolean);
  const maxAttempts = 1;
  const requestTimeout = Math.min(timeout || 20000, 20000);
  let lastErr;

  for (const currentModel of models) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await axios.post(
          `${baseUrl}/chat/completions`,
          {
            model: currentModel,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: prompt },
                  { type: 'image_url', image_url: { url: dataUrl } }
                ]
              }
            ],
            temperature: 0.2,
            max_tokens: 2048
          },
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            timeout: requestTimeout
          }
        );

        console.log(`Kimi识别成功 model=${currentModel}`);
        return response.data.choices[0].message.content;
      } catch (err) {
        lastErr = err;
        const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        console.error(`Kimi API调用失败 model=${currentModel} attempt=${attempt}/${maxAttempts}:`, detail);

        if (!isRetryableAIError(err)) {
          const friendlyMessage = getFriendlyAIError(err);
          const wrapped = new Error(`${friendlyMessage}：${getErrorDetail(err)}`);
          wrapped.cause = err;
          throw wrapped;
        }
      }
    }

    await new Promise(resolve => setTimeout(resolve, 800));
  }

  const friendlyMessage = getFriendlyAIError(lastErr || {});
  throw new Error(`${friendlyMessage}，已尝试${models.length}个Kimi视觉模型`);
}

async function callKimiWithImageUrl(imageUrl) {
  const dataUrl = await buildImageDataUrl(imageUrl);
  const content = await callKimiAPI(dataUrl);
  parseAIResponse(content);
  console.log('AI识别供应商: kimi');
  return content;
}

/**
 * 获取图片临时URL
 */
async function getImageUrl(fileID) {
  const { fileList } = await cloud.getTempFileURL({ fileList: [fileID] });
  if (!fileList || fileList.length === 0 || !fileList[0].tempFileURL) {
    throw new Error('无法获取图片URL');
  }
  return fileList[0].tempFileURL;
}

// 判断文件是否为PDF
function isPdfFile(fileID) {
  return fileID.toLowerCase().endsWith('.pdf');
}

// 云函数入口
exports.main = async (event, context) => {
  try {
    await assertCallerAccess(cloud.database(), cloud.getWXContext().OPENID);
  } catch (err) {
    return error(err.message);
  }

  // 兼容前端传的 imageUrl（云存储 fileID）或 fileID
  const imageFileID = event.imageUrl || event.fileID;
  const fileType = event.fileType || 'image';

  if (!imageFileID) {
    return error('缺少图片参数，请传 imageUrl 或 fileID');
  }

  try {
    // 获取文件URL
    const fileUrl = await getImageUrl(imageFileID);

    // PDF：先尝试Kimi识别，如果失败返回友好提示
    if (fileType === 'pdf' || isPdfFile(imageFileID)) {
      try {
        const aiContent = await callKimiWithImageUrl(fileUrl);
        console.log('AI原始返回:', aiContent);
        const aiData = parseAIResponse(aiContent);
        console.log('AI解析结果:', JSON.stringify(aiData));
        const normalized = normalizeShipmentData(aiData);
        const { cargoInfo, routing, contacts, handwritingDetected, reviewFields } = normalized;
        const buildField = (val, unit, fieldName) => ({
          val: val != null ? val : null,
          unit: unit || null,
          manualReview: reviewFields.includes(fieldName)
        });
        return success({
          shipmentInfo: {
            warehouseEntryNo: buildField(cargoInfo.warehouseEntryNo, null, '进仓编号'),
            waybillNo: buildField(cargoInfo.waybillNo, null, '业务参与编号'),
            pieces: buildField(cargoInfo.pieces, cargoInfo.piecesUnit, '件数'),
            weight: buildField(cargoInfo.grossWeight, cargoInfo.weightUnit, '重量'),
            volume: buildField(cargoInfo.volume, cargoInfo.volumeUnit, '体积'),
            marks: buildField(cargoInfo.marks, null, '唛头')
          },
          routing: {
            warehouseName: buildField(routing.warehouseName, null, '仓库名称'),
            destinationPort: buildField(routing.destinationPort, null, '目的港'),
            departureTime: buildField(routing.departureTime, null, '预计开航'),
            latestDeliveryTime: buildField(routing.latestDeliveryTime, null, '最晚进仓')
          },
          contacts: {
            factoryName: buildField(contacts.factoryName, null, '工厂名称'),
            contactPerson: buildField(contacts.contactPerson, null, '联系人'),
            contactPhone: buildField(contacts.contactPhone, null, '联系电话')
          },
          handwritingDetected,
          handwrittenFields: reviewFields
        });
      } catch (pdfErr) {
        console.error('PDF识别失败:', pdfErr.message);
        return error('PDF自动识别暂不可用，请手动录入信息');
      }
    }

    // 图片：正常流程
    const aiContent = await callKimiWithImageUrl(fileUrl);
    console.log('AI原始返回:', aiContent);
    const aiData = parseAIResponse(aiContent);
    console.log('AI解析结果:', JSON.stringify(aiData));
    const normalized = normalizeShipmentData(aiData);
    const { cargoInfo, routing, contacts, handwritingDetected, reviewFields } = normalized;

    const buildField = (val, unit, fieldName) => ({
      val: val != null ? val : null,
      unit: unit || null,
      manualReview: reviewFields.includes(fieldName)
    });

    const result = {
      shipmentInfo: {
        warehouseEntryNo: buildField(cargoInfo.warehouseEntryNo, null, '进仓编号'),
        waybillNo: buildField(cargoInfo.waybillNo, null, '业务参与编号'),
        pieces: buildField(cargoInfo.pieces, cargoInfo.piecesUnit, '件数'),
        weight: buildField(cargoInfo.grossWeight, cargoInfo.weightUnit, '重量'),
        volume: buildField(cargoInfo.volume, cargoInfo.volumeUnit, '体积'),
        marks: buildField(cargoInfo.marks, null, '唛头')
      },
      routing: {
        warehouseName: buildField(routing.warehouseName, null, '仓库名称'),
        destinationPort: buildField(routing.destinationPort, null, '目的港'),
        departureTime: buildField(routing.departureTime, null, '预计开航'),
        latestDeliveryTime: buildField(routing.latestDeliveryTime, null, '最晚进仓')
      },
      contacts: {
        factoryName: buildField(contacts.factoryName, null, '工厂名称'),
        contactPerson: buildField(contacts.contactPerson, null, '联系人'),
        contactPhone: buildField(contacts.contactPhone, null, '联系电话')
      },
      handwritingDetected,
      handwrittenFields: reviewFields
    };

    return success(result);

  } catch (err) {
    console.error('AI解析失败:', err);
    return error(err.message);
  }
};
