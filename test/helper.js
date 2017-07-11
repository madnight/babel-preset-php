const assert = require('assert');
const babel = require("babel-core");
const phpPreset = require("../index");

module.exports = function translates(phpSrc, expected = undefined) {
    let ignoreSemi = false;
    if (undefined === expected) {
        expected = phpSrc.replace(/\$/g, '').replace(/;/g, '');
        ignoreSemi = true;
    }
    let out;
    try {
        out = babel.transform(`<?php ${phpSrc}`, {
            presets: [phpPreset],
        }).code;
    } catch(e) {
        e.message += `\nin ${phpSrc}`;
        throw e;
    }
    if (ignoreSemi) {
        out = out.replace(/;/g, '');
    }
    if ('string' !== typeof out || expected.replace(/\s/g, '') !== out.replace(/\s/g, '')) {
        assert.equal(out, expected);
    }
}
