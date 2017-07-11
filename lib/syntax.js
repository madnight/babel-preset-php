const trans = require('./trans');
const Engine = require('php-parser');

module.exports = function() {
    return {
        manipulateOptions(opts, parserOpts) {
            opts.parserOpts = {
                parser(code, opts) {
                    const parser = new Engine({
                        parser: {
                            extractDoc: true
                        },
                        ast: {
                            withPositions: true
                        }
                    });

                    const ast = parser.parseCode(code, {filename: opts.sourceFileName});
                    return trans.translateProgram(ast);
                },
            };
        },
    };
};
