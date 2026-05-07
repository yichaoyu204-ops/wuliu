/**
 * AI单据识别云函数
 * 调用Kimi API识别进仓通知单
 * 此文件修改不会影响历史数据
 */

const cloud = require('wx-server-sdk');
const axios = require('axios');
const Jimp = require('jimp');
const config = require('./config');
const { parseAIResponse, normalizeShipmentData } = require('./utils/aiParser');
const { success, error } = require('./utils/response');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

/**
 * 图片放大处理：短边小于阈值时等比放大
 * 让AI能看清进仓单上的小字
 */
async function resizeImageIfNeeded(buffer) {
  try {
    const image = await Jimp.read(buffer);
    const width = image.getWidth();
    const height = image.getHeight();
    const minSide = Math.min(width, height);
    const targetMin = 1024; // 短边目标像素

    if (minSide < targetMin) {
      const scale = targetMin / minSide;
      image.scale(scale, Jimp.RESIZE_BILINEAR);
      console.log(`图片已放大: ${width}x${height} -> ${image.getWidth()}x${image.getHeight()}, scale=${scale.toFixed(2)}`);
    } else {
      console.log(`图片尺寸足够: ${width}x${height}, 无需放大`);
    }

    // 统一转为JPEG，控制质量避免base64过大
    return await image.quality(90).getBufferAsync(Jimp.MIME_JPEG);
  } catch (err) {
    console.error('图片放大处理失败，使用原图:', err.message);
    return buffer;
  }
}

/**
 * 调用Kimi API进行图片识别
 * 可在config/index.js中修改prompt来优化识别效果
 */
async function callKimiAPI(imageUrl) {
  const { apiKey, baseUrl, model, prompt, timeout } = config.kimi;

  if (!apiKey) {
    throw new Error('Kimi API Key未配置，请在云函数环境变量中设置KIMI_API_KEY');
  }

  try {
    // 下载图片（Kimi不支持微信云存储的签名URL）
    const imageRes = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 10000 });
    // 放大图片：短边小于1024时等比放大，让AI看清文字
    const processedBuffer = await resizeImageIfNeeded(Buffer.from(imageRes.data, 'binary'));
    const base64Image = processedBuffer.toString('base64');
    const mimeType = imageRes.headers['content-type'] || 'image/jpeg';
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model: model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: dataUrl } }
            ]
          }
        ],
        temperature: 0.3,
        max_tokens: 2048
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: timeout || 20000
      }
    );

    return response.data.choices[0].message.content;
  } catch (err) {
    console.error('Kimi API调用失败:', err.message);
    if (err.response && err.response.data) {
      console.error('Kimi 详细错误:', JSON.stringify(err.response.data));
      throw new Error(`AI识别失败[${err.response.status}]: ${JSON.stringify(err.response.data)}`);
    }
    throw new Error(`AI识别失败: ${err.message}`);
  }
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
        const aiContent = await callKimiAPI(fileUrl);
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
            waybillNo: buildField(cargoInfo.waybillNo, null, '业务编号'),
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
    const aiContent = await callKimiAPI(fileUrl);
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
        waybillNo: buildField(cargoInfo.waybillNo, null, '业务编号'),
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
