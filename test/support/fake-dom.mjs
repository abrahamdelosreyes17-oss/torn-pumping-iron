/*
 * A stand-in DOM for the node tests of round 8's Torn Eye looks: enough for ui/dom.js `h` (elements, attributes,
 * classes, text, listeners) and for reading back what was built. No layout.
 */
export class FakeEl {
    constructor(tag, text = null) {
        this.tagName = tag ? tag.toUpperCase() : '#text';
        this.children = [];
        this.attrs = {};
        this.text = text;
        this.listeners = {};
        this.style = { setProperty(k, v) { this[k] = v; } };
        const self = this;
        const list = () => (self.attrs.class || '').split(' ').filter(Boolean);
        this.classList = {
            add: (...c) => self.setAttribute('class', [...new Set([...list(), ...c])].join(' ')),
            remove: (...c) => self.setAttribute('class', list().filter((x) => !c.includes(x)).join(' ')),
            toggle: (c, on) => (on === undefined ? !list().includes(c) : on) ? self.classList.add(c) : self.classList.remove(c),
            contains: (c) => list().includes(c),
        };
    }
    setAttribute(k, v) {
        this.attrs[k] = String(v);
    }
    getAttribute(k) {
        return this.attrs[k] ?? null;
    }
    removeAttribute(k) {
        delete this.attrs[k];
    }
    set id(v) {
        this.attrs.id = String(v);
    }
    get id() {
        return this.attrs.id || '';
    }
    set className(v) {
        this.attrs.class = String(v);
    }
    get className() {
        return this.attrs.class || '';
    }
    addEventListener(type, fn) {
        (this.listeners[type] = this.listeners[type] || []).push(fn);
    }
    appendChild(c) {
        this.children.push(c);
        if (c && typeof c === 'object') c.parent = this;
        return c;
    }
    /** One simple selector: tag, .class, [attr] or [attr="value"] (and those joined, e.g. `i.arr`). */
    matches(sel) {
        const parts = sel.match(/^[a-z0-9]+|\.[\w-]+|\[[^\]]+\]/gi) || [];
        return parts.every((p) => {
            if (p[0] === '.') return this.classList.contains(p.slice(1));
            if (p[0] === '[') {
                const [k, v] = p.slice(1, -1).split('=');
                return k in this.attrs && (v === undefined || this.attrs[k] === v.replace(/^"|"$/g, ''));
            }
            return this.tagName === p.toUpperCase();
        });
    }
    /** Descendants matching simple selectors separated by blanks (`.pi-ctm i`). */
    querySelectorAll(sel) {
        const steps = sel.trim().split(/\s+/);
        let found = [this];
        for (const s of steps) found = [...new Set(found.flatMap((n) => n.children.flatMap((c) => (c.find ? c.find((x) => x.tagName !== '#text' && x.matches(s)) : []))))];
        return found;
    }
    querySelector(sel) {
        return this.querySelectorAll(sel)[0] || null;
    }
    closest(sel) {
        for (let n = this; n; n = n.parent) if (n.tagName !== '#text' && n.matches(sel)) return n;
        return null;
    }
    get firstChild() {
        return this.children[0] || null;
    }
    removeChild(c) {
        this.children = this.children.filter((x) => x !== c);
        return c;
    }
    set textContent(v) {
        this.text = String(v);
        this.children = [];
    }
    get textContent() {
        return (this.text || '') + this.children.map((c) => c.textContent).join('');
    }
    /** Every node under this one (itself too) that `pred` accepts. */
    find(pred, out = []) {
        if (pred(this)) out.push(this);
        for (const c of this.children) if (c.find) c.find(pred, out);
        return out;
    }
    /** The nodes carrying this class. */
    byClass(c) {
        return this.find((n) => n.classList && n.classList.contains(c));
    }
    /** The nodes carrying this attribute (with this value, when given). */
    byAttr(k, v = null) {
        return this.find((n) => n.attrs && k in n.attrs && (v === null || n.attrs[k] === String(v)));
    }
    /** Fire a listener set with addEventListener (h's onclick). */
    fire(type, ev = {}) {
        for (const fn of this.listeners[type] || []) fn({ preventDefault() {}, stopPropagation() {}, target: this, ...ev });
    }
}

/** Put the stand-in document in place (before the module under test is imported). */
export function installFakeDom() {
    globalThis.document = { createElement: (t) => new FakeEl(t), createElementNS: (_, t) => new FakeEl(t), createTextNode: (t) => new FakeEl(null, t), createDocumentFragment: () => new FakeEl('fragment') };
    return globalThis.document;
}

/** Text with runs of blanks as one. */
export const cleanText = (s) => String(s).replace(/\s+/g, ' ').trim();
