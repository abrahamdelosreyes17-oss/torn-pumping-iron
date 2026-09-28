/*
 * Masked API key boxes, the same way on every page.
 *
 * A key box must hide what is typed WITHOUT being a password field: Chrome,
 * Edge and password managers offer to save (and sync) whatever is typed in a
 * type="password" box, and a Full key in a synced password store is a key
 * outside our control. So the box is type="text" and CSS hides the letters
 * (-webkit-text-security, which Chrome, Edge and Safari support).
 *
 * Where CSS cannot mask (some Firefox builds), a plain text box would show
 * the key in the clear; there, and only there, it falls back to a password
 * box with saving discouraged (autocomplete off, password-manager opt-outs).
 */

/** Can this browser hide a text box's letters with CSS? */
export function cssMaskSupported() {
    try {
        return Boolean(
            typeof CSS !== 'undefined' &&
                CSS.supports &&
                (CSS.supports('-webkit-text-security', 'disc') || CSS.supports('text-security', 'disc')),
        );
    } catch {
        return false;
    }
}

/** The attributes every key box gets: no autofill, no spellcheck, no password-manager capture. */
export function keyInputAttrs() {
    return {
        type: cssMaskSupported() ? 'text' : 'password',
        autocomplete: 'off',
        autocapitalize: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
        'data-lpignore': 'true',
        'data-1p-ignore': 'true',
        'data-bwignore': 'true',
        'data-form-type': 'other',
    };
}

/** A revealed saved key is taken out of the box again after this long. */
export const REVEAL_MS = 60000;

/**
 * Show / hide for one key box.
 *
 * @param {HTMLInputElement} input
 * @param {string} maskedClass - the page's CSS class that hides the letters
 * @param {object} [opts]
 * @param {function} [opts.onReveal] - () => the saved key, put in the box only while shown
 * @param {function} [opts.onChange] - (hidden) => void, e.g. to relabel a Show button
 * @returns {{hidden: function, toggle: function, hide: function}}
 */
export function keyMask(input, maskedClass, { onReveal = null, onChange = () => {} } = {}) {
    const byCss = input.type !== 'password';
    let hidden = true;
    let revealed = false;
    let timer = null;

    const apply = () => {
        if (byCss) input.classList.toggle(maskedClass, hidden);
        else input.type = hidden ? 'password' : 'text';
        onChange(hidden);
    };

    const hide = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        hidden = true;
        // A saved key shown on request never stays in the box: any script
        // that can reach the box could read it.
        if (revealed) {
            input.value = '';
            revealed = false;
        }
        apply();
    };

    const show = () => {
        hidden = false;
        if (!input.value && onReveal) {
            input.value = onReveal() || '';
            revealed = true;
            timer = setTimeout(hide, REVEAL_MS);
        }
        apply();
    };

    if (byCss) input.classList.add(maskedClass);
    return {
        hidden: () => hidden,
        toggle: () => (hidden ? show() : hide()),
        hide,
    };
}
