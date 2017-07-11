const plugins = require('./lib/plugins');
const syntaxPlugin = require('./lib/syntax');

module.exports = function() {
    return {
        plugins: [
            syntaxPlugin,
            plugins.defineToConstant,
            plugins.isDefined,
            plugins.functionExists,
            plugins.arrayFunctions,
            plugins.stringFunctions,
            plugins.mathFunctions,
            plugins.otherFunctions,
            plugins.renameException,
            plugins.superglobals,
        ],
    };
}
