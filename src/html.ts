/**
 * 受控 HTML → DocumentFragment（官方 eslint 要求替代 innerHTML/createContextualFragment）：
 * DOMParser 独立文档解析不执行脚本、不加载资源；挂入 live DOM 前剥除 script/iframe 等活动元素
 */
const VT_HTML_PARSER = new DOMParser();
export function parseTrustedHtml(html: string): DocumentFragment {
        const frag = VT_HTML_PARSER.parseFromString(html, 'text/html');
        frag.body.querySelectorAll('script, iframe, object, embed').forEach((n) => n.remove());
        return frag.body;
}
