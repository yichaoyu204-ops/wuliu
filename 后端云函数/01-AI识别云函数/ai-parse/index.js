/**
 * AI单据识别云函数
 * 调用Kimi API识别进仓通知单，Kimi过载时自动切换通义千问
 * 此文件修改不会影响历史数据
 */

const cloud = require('wx-server-sdk');
const axios = require('axios');
const config = require('./config');
const { parseAIResponse, normalizeShipmentData } = require('./utils/aiParser');
const { success, error } = require('./utils/response');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

// ============================================
// 图片处理
// ============================================

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

/**
 * 判断文件是否为PDF
 */
function isPdfFile(fileID) {
  return fileID.toLowerCase().endsWith('.pdf');
}

/**
 * 放大图片以提高OCR精度
 * 微信小程序图片可能压缩，放大后更容易识别小字
 */
function getScaledImageUrl(imageUrl) {
  // 如果URL本身包含参数，追加
  const separator = imageUrl.includes('?') ? '&' : '?';
  return `${imageUrl}${separator}x-oss-process=image/resize,p_90`;
}

// ============================================
// Kimi API 调用（多模型fallback）
// ============================================

/**
 * 调用Kimi API进行图片识别
 * 依次尝试所有配置的Kimi视觉模型
 * 可在config.js中修改prompt来优化识别效果
 */
async function callKimiAPI(imageUrl) {
  const { apiKey, baseUrl, models, prompt, timeout } = config.kimi;

  if (!apiKey) {
    throw new Error('Kimi API Key未配置');
  }

  const lastErrors = [];

  for (const model of models) {
    try {
      const response = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model: model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: imageUrl } }
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
      const errMsg = err.response?.data?.error?.message || err.message;
      const errType = err.response?.data?.error?.type || '';
      console.error(`Kimi API调用失败 model=${model} attempt=1/1:`, JSON.stringify({ error: { message: errMsg, type: errType } }));
      lastErrors.push({ model, message: errMsg, type: errType });
      // 继续尝试下一个模型
    }
  }

  // 所有模型都失败了
  const allOverloaded = lastErrors.every(e => e.type === 'engine_overloaded_error');
  if (allOverloaded) {
    throw new Error('AI服务当前繁忙，请稍后再试，已尝试' + models.length + '个Kimi视觉模型');
  }
  throw new Error('Kimi API调用失败: ' + lastErrors[lastErrors.length - 1].message);
}

// ============================================
// 通义千问 API 调用（Kimi 备选）
// ============================================

/**
 * 调用通义千问API进行图片识别
 * Kimi全部过载时自动切换
 */
async function callDashScopeAPI(imageUrl) {
  const { apiKey, baseUrl, model, timeout } = config.dashscope;

  if (!apiKey) {
    throw new Error('通义千问 API Key未配置，请在云函数环境变量中设置DASHSCOPE_API_KEY');
  }

  // 通义千问使用相同的prompt
  const prompt = config.kimi.prompt;

  try {
    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model: model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } }
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
    const errMsg = err.response?.data?.error?.message || err.message;
    console.error('通义千问 API调用失败:', errMsg);
    throw new Error(`AI识别失败: ${errMsg}`);
  }
}

// ============================================
// 主流程：Kimi → 通义千问 fallback
// ============================================

/**
 * 尝试用Kimi识别，失败自动切换通义千问
 */
async function callAIWithImageUrl(imageUrl, fileType) {
  // 1. 先尝试Kimi（所有模型）
  try {
    const content = await callKimiAPI(imageUrl);
    return { provider: 'kimi', content };
  } catch (kimiErr) {
    const kimiMsg = kimiErr.message || '';
    const isOverloaded = kimiMsg.includes('繁忙') || kimiMsg.includes('overloaded');

    // 如果Kimi是引擎过载，尝试通义千问
    if (isOverloaded) {
      console.log('Kimi全部过载，尝试切换通义千问...');
      try {
        const content = await callDashScopeAPI(imageUrl);
        return { provider: 'dashscope', content };
      } catch (dsErr) {
        console.error('通义千问也失败了:', dsErr.message);
        throw new Error(`${kimiMsg}；通义千问备选也失败: ${dsErr.message}`);
      }
    }

    // Kimi 是其他错误（如key无效、网络等），直接抛出
    throw kimiErr;
  }
}

/**
 * 解析AI返回内容并统一返回格式
 */
function buildResponse(aiContent) {
  const aiData = parseAIResponse(aiContent);
  const normalized = normalizeShipmentData(aiData);
  const { cargoInfo, routing, contacts, handwritingDetected, reviewFields } = normalized;

  const buildField = (val, unit, fieldName) => ({
    val: val != null ? val : null,
    unit: unit || null,
    manualReview: reviewFields.includes(fieldName)
  });

  return success({
    shipmentInfo: {
      waybillNo: buildField(cargoInfo.waybillNo, null, '运单号'),
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
    let fileUrl = await getImageUrl(imageFileID);

    // 图片放大以提高识别精度
    if (fileType === 'image') {
      const originalUrl = fileUrl;
      fileUrl = getScaledImageUrl(fileUrl);
      console.log(`图片已放大: ${originalUrl.length > 60 ? '...' : originalUrl} -> ${fileUrl.length > 60 ? '...' : fileUrl}`);
    }

    // PDF：先尝试AI识别，如果失败返回友好提示
    if (fileType === 'pdf' || isPdfFile(imageFileID)) {
      try {
        const { content } = await callAIWithImageUrl(fileUrl, fileType);
        return buildResponse(content);
      } catch (pdfErr) {
        console.error('PDF识别失败:', pdfErr.message);
        return error('PDF自动识别暂不可用，请手动录入信息');
      }
    }

    // 图片：正常流程，Kimi -> 通义千问 fallback
    const { provider, content } = await callAIWithImageUrl(fileUrl, fileType);
    console.log(`AI识别成功，使用服务商: ${provider}`);
    return buildResponse(content);

  } catch (err) {
    console.error('AI解析失败:', err);
    return error(err.message);
  }
};
