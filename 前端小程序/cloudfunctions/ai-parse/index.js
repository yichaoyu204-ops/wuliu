/**
 * AI单据识别云函数
 * 调用Kimi API识别进仓通知单，Kimi过载时自动切换通义千问
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

async function resizeImageIfNeeded(buffer) {
  try {
    const image = await Jimp.read(buffer);
    const width = image.getWidth();
    const height = image.getHeight();
    const minSide = Math.min(width, height);
    const targetMin = 1024;
    if (minSide < targetMin) {
      const scale = targetMin / minSide;
      image.scale(scale, Jimp.RESIZE_BILINEAR);
      console.log('图片已放大: ' + width + 'x' + height + ' -> ' + image.getWidth() + 'x' + image.getHeight() + ', scale=' + scale.toFixed(2));
    } else {
      console.log('图片尺寸足够: ' + width + 'x' + height + ', 无需放大');
    }
    return await image.quality(90).getBufferAsync(Jimp.MIME_JPEG);
  } catch (err) {
    console.error('图片放大处理失败，使用原图:', err.message);
    return buffer;
  }
}

async function downloadImageAsBase64(imageUrl) {
  const imageRes = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 10000 });
  const processedBuffer = await resizeImageIfNeeded(Buffer.from(imageRes.data, 'binary'));
  const base64Image = processedBuffer.toString('base64');
  const mimeType = imageRes.headers['content-type'] || 'image/jpeg';
  return 'data:' + mimeType + ';base64,' + base64Image;
}

async function getImageUrl(fileID) {
  const { fileList } = await cloud.getTempFileURL({ fileList: [fileID] });
  if (!fileList || fileList.length === 0 || !fileList[0].tempFileURL) {
    throw new Error('无法获取图片URL');
  }
  return fileList[0].tempFileURL;
}

function isPdfFile(fileID) {
  return fileID.toLowerCase().endsWith('.pdf');
}

async function callKimiAPI(dataUrl) {
  const { apiKey, baseUrl, models, prompt, timeout } = config.kimi;
  if (!apiKey) {
    throw new Error('Kimi API Key未配置');
  }
  const lastErrors = [];
  for (const model of models) {
    try {
      const response = await axios.post(
        baseUrl + '/chat/completions',
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
            'Authorization': 'Bearer ' + apiKey,
            'Content-Type': 'application/json'
          },
          timeout: timeout || 45000
        }
      );
      return response.data.choices[0].message.content;
    } catch (err) {
      const errMsg = (err.response && err.response.data && err.response.data.error && err.response.data.error.message) || err.message;
      const errType = (err.response && err.response.data && err.response.data.error && err.response.data.error.type) || '';
      console.error('Kimi API调用失败 model=' + model + ':', JSON.stringify({ error: { message: errMsg, type: errType } }));
      lastErrors.push({ model: model, message: errMsg, type: errType });
    }
  }
  const allOverloaded = lastErrors.every(function(e) { return e.type === 'engine_overloaded_error'; });
  if (allOverloaded) {
    throw new Error('AI服务当前繁忙，请稍后再试，已尝试' + models.length + '个Kimi视觉模型');
  }
  throw new Error('Kimi API调用失败: ' + lastErrors[lastErrors.length - 1].message);
}

async function callDashScopeAPI(dataUrl) {
  const { apiKey, baseUrl, model, timeout } = config.dashscope;
  if (!apiKey) {
    throw new Error('通义千问 API Key未配置，请在云函数环境变量中设置DASHSCOPE_API_KEY');
  }
  const prompt = config.kimi.prompt;
  try {
    const response = await axios.post(
      baseUrl + '/chat/completions',
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
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json'
        },
        timeout: timeout || 45000
      }
    );
    return response.data.choices[0].message.content;
  } catch (err) {
    const errMsg = (err.response && err.response.data && err.response.data.error && err.response.data.error.message) || err.message;
    console.error('通义千问 API调用失败:', errMsg);
    throw new Error('AI识别失败: ' + errMsg);
  }
}

async function callAIWithImageUrl(dataUrl) {
  try {
    const content = await callKimiAPI(dataUrl);
    return { provider: 'kimi', content: content };
  } catch (kimiErr) {
    const kimiMsg = kimiErr.message || '';
    const isOverloaded = kimiMsg.indexOf('繁忙') !== -1 || kimiMsg.indexOf('overloaded') !== -1;
    if (isOverloaded) {
      console.log('Kimi全部过载，尝试切换通义千问...');
      try {
        const content = await callDashScopeAPI(dataUrl);
        return { provider: 'dashscope', content: content };
      } catch (dsErr) {
        console.error('通义千问也失败了:', dsErr.message);
        throw new Error(kimiMsg + '；通义千问备选也失败: ' + dsErr.message);
      }
    }
    throw kimiErr;
  }
}

function buildResponse(aiContent) {
  console.log('AI原始返回:', aiContent);
  const aiData = parseAIResponse(aiContent);
  console.log('AI解析结果:', JSON.stringify(aiData));
  const normalized = normalizeShipmentData(aiData);
  const cargoInfo = normalized.cargoInfo;
  const routing = normalized.routing;
  const contacts = normalized.contacts;
  const handwritingDetected = normalized.handwritingDetected;
  const reviewFields = normalized.reviewFields;

  const buildField = function(val, unit, fieldName) {
    return {
      val: val != null ? val : null,
      unit: unit || null,
      manualReview: reviewFields.indexOf(fieldName) !== -1
    };
  };

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
    handwritingDetected: handwritingDetected,
    handwrittenFields: reviewFields
  });
}

exports.main = async function(event, context) {
  const imageFileID = event.imageUrl || event.fileID;
  const fileType = event.fileType || 'image';

  if (!imageFileID) {
    return error('缺少图片参数，请传 imageUrl 或 fileID');
  }

  try {
    const fileUrl = await getImageUrl(imageFileID);

    if (fileType === 'pdf' || isPdfFile(imageFileID)) {
      try {
        const dataUrl = await downloadImageAsBase64(fileUrl);
        const result = await callAIWithImageUrl(dataUrl);
        return buildResponse(result.content);
      } catch (pdfErr) {
        console.error('PDF识别失败:', pdfErr.message);
        return error('PDF自动识别暂不可用，请手动录入信息');
      }
    }

    const dataUrl = await downloadImageAsBase64(fileUrl);
    const result = await callAIWithImageUrl(dataUrl);
    console.log('AI识别成功，使用服务商:', result.provider);
    return buildResponse(result.content);

  } catch (err) {
    console.error('AI解析失败:', err);
    return error(err.message);
  }
};
