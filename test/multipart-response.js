'use strict';

// 测试辅助：解析 /api/reprint 的 multipart/form-data 响应体。
// 响应由服务端按固定结构生成：plan 部分（JSON 文本）+ pdf 部分（原始二进制），
// CRLF 分隔、无嵌套分段；PDF 部分按原始字节返回，不经文本解码。
const assert = require('assert');

/**
 * 按边界拆分 multipart 响应体。
 * @param {Buffer} body 完整响应体
 * @param {string} contentType 响应 Content-Type（含 boundary 参数）
 * @returns {Array<{ name: string|null, headers: string, content: Buffer }>}
 */
function parseMultipartParts(body, contentType) {
  const match = /boundary="?([^\s";]+)"?/i.exec(contentType || '');
  assert.ok(match, `Content-Type 缺少 boundary：${contentType}`);
  const firstBoundary = Buffer.from(`--${match[1]}`, 'latin1');
  const delimiter = Buffer.from(`\r\n--${match[1]}`, 'latin1');
  const parts = [];
  let pos = body.indexOf(firstBoundary);
  assert.ok(pos >= 0, '找不到起始边界');
  while (true) {
    const headStart = pos + firstBoundary.length;
    // 结束边界：--boundary--
    if (body[headStart] === 0x2d && body[headStart + 1] === 0x2d) break;
    assert.strictEqual(body[headStart], 0x0d, '边界后应为 CRLF');
    assert.strictEqual(body[headStart + 1], 0x0a, '边界后应为 CRLF');
    const headEnd = body.indexOf('\r\n\r\n', headStart + 2);
    assert.ok(headEnd >= 0, '分段头未以空行结束');
    const headers = body.slice(headStart + 2, headEnd).toString('latin1');
    const contentStart = headEnd + 4;
    // 下一分隔符含前导 CRLF（属于分隔符，不属于内容）
    const next = body.indexOf(delimiter, contentStart);
    assert.ok(next >= 0, '找不到下一段边界');
    const nameMatch = /name="([^"]+)"/.exec(headers);
    parts.push({
      name: nameMatch ? nameMatch[1] : null,
      headers,
      content: body.slice(contentStart, next),
    });
    pos = next + 2; // 跳过分隔符前导 CRLF，指向下一个 --boundary
  }
  return parts;
}

/**
 * 解析 /api/reprint 的成功响应：校验整体格式后返回 { plan, pdf }。
 * @param {{ headers: object, body: Buffer }} resp request 辅助函数的返回
 * @returns {{ plan: object, pdf: Buffer }} 方案 JSON（已解析）与 PDF 原始字节
 */
function parseReprintResponse(resp) {
  assert.ok(
    (resp.headers['content-type'] || '').includes('multipart/form-data'),
    `补印响应应为 multipart/form-data：${resp.headers['content-type']}`,
  );
  assert.ok(!resp.headers['x-reprint-plan'], '补印明细不再通过响应头回传');
  const parts = parseMultipartParts(resp.body, resp.headers['content-type']);
  const planPart = parts.find((p) => p.name === 'plan');
  const pdfPart = parts.find((p) => p.name === 'pdf');
  assert.ok(planPart, '响应缺少 plan 部分（补印方案 JSON）');
  assert.ok(pdfPart, '响应缺少 pdf 部分（补印 PDF）');
  assert.match(planPart.headers, /Content-Type:\s*application\/json/i);
  assert.match(pdfPart.headers, /Content-Type:\s*application\/pdf/i);
  return { plan: JSON.parse(planPart.content.toString('utf8')), pdf: pdfPart.content };
}

module.exports = { parseMultipartParts, parseReprintResponse };
