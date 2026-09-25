// 极简 .dc.html 运行时：支持本预览用到的 {{hole}}、sc-for、sc-if、onClick 与 DCLogic
(function () {
  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state) : p); this.__render && this.__render(); }
    forceUpdate() { this.__render && this.__render(); }
  }
  window.DCLogic = DCLogic;

  const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  function lookup(expr, ctx) {
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    return expr.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);
  }
  function whole(str, ctx) {
    const m = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/.exec(str || '');
    return m ? lookup(m[1], ctx) : str;
  }
  function interp(str, ctx) {
    return str.replace(HOLE, (_, e) => { const v = lookup(e, ctx); return v == null ? '' : String(v); });
  }

  function build(node, ctx, out) {
    if (node.nodeType === 3) { out.appendChild(document.createTextNode(interp(node.nodeValue, ctx))); return; }
    if (node.nodeType !== 1) return;
    const tag = node.localName;
    if (tag === 'sc-for') {
      const list = whole(node.getAttribute('list'), ctx) || [];
      const as = node.getAttribute('as') || 'item';
      list.forEach((item, i) => {
        const c = Object.assign({}, ctx, { [as]: item, $index: i });
        node.childNodes.forEach((ch) => build(ch, c, out));
      });
      return;
    }
    if (tag === 'sc-if') {
      if (whole(node.getAttribute('value'), ctx)) node.childNodes.forEach((ch) => build(ch, ctx, out));
      return;
    }
    const el = node.cloneNode(false);
    for (const a of Array.from(el.attributes)) {
      if (/^on[a-z]+$/i.test(a.name)) {
        el.removeAttribute(a.name);
        const fn = whole(a.value, ctx);
        if (typeof fn === 'function') el.addEventListener(a.name.slice(2).toLowerCase(), fn);
      } else if (a.value.indexOf('{{') !== -1) {
        el.setAttribute(a.name, interp(a.value, ctx));
      }
    }
    const src = node.localName === 'template' ? node.content : node;
    src.childNodes.forEach((ch) => build(ch, ctx, el));
    out.appendChild(el);
  }

  window.mountDC = function (tplId, scriptId, rootId) {
    const tpl = document.getElementById(tplId).content;
    const Component = new Function('DCLogic', document.getElementById(scriptId).textContent + '\n;return Component;')(DCLogic);
    const comp = new Component({});
    const root = document.getElementById(rootId);
    comp.__render = () => {
      const vals = comp.renderVals();
      const frag = document.createDocumentFragment();
      tpl.childNodes.forEach((ch) => build(ch, vals, frag));
      root.replaceChildren(frag);
    };
    comp.__render();
    comp.componentDidMount && comp.componentDidMount();
  };
})();
