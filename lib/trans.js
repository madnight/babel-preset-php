const assert = require('assert');
const Scope = require('./scope');

exports.translateProgram = function translateProgram(program) {
    assert.equal(program.kind, "program");
    const scope = new Scope();
    return {
        type: "File",
        loc: translateLoc(program.loc),
        "program": addChildrenToBody({
            type: "Program",
            "sourceType": "script",
            "body": [],
        }, program.children, scope),
    };
}

function makeIdent(name, loc) {
    return {
        type: "Identifier",
        name,
        loc: translateLoc(loc),
    };
}

function translateLoc(loc) {
    if (!loc) return undefined;
    assert("start" in loc);
    return loc;
}

function translateArrayEntry(node, scope) {
    return makeArrayEntry(node.key, translateExpr(node.value, scope), node.loc, scope)
}

function makeArrayEntry(node, valueJS, loc, scope) {
    let computed = true;
    let key = translateExpr(node, scope);
    if (!node) {
        computed = false;
        key = makeIdent(scope.currentArrayIndex++, loc);
    } else if (node.kind === 'number') {
        computed = false;
        scope.currentArrayIndex = ++node.value;
    } else if (node.kind == 'string') {
        computed = false;
        if (isIdentifierCompatibleString(node)) {
            key = makeIdent(node.value, node.loc);
        }
    }

    return {
        type: "ObjectProperty",
        loc: translateLoc(loc),
        key,
        value: valueJS,
        computed,
    };
}

function translateArray(node, scope) {
    assert(scope instanceof Scope);
    if (node.items.length === 0) {
        return {
            type: "CallExpression",
            loc: translateLoc(node.loc),
            callee: makeIdent('Array', node.loc),
            arguments: [],
            typeAnnotation: makeAnnotation("TypeAnnotation", {typeAnnotation: makeAmbiguousArrayAnnotation(node.loc)}, node.loc),
        };
    }
    if (node.items.some(a => a.key)) {
        const arrScope = scope.push({currentArrayIndex:0});
        return {
            type: "ObjectExpression",
            loc: translateLoc(node.loc),
            properties: node.items.map(e => translateArrayEntry(e, arrScope)),
        }
    }
    return {
        type: "ArrayExpression",
        loc: translateLoc(node.loc),
        elements: node.items.map(e => translateExpr(e.value, scope)),
    };
}

function translateVariable(node, scope) {
    assert(scope instanceof Scope);
    if (node.kind === 'constref') {
        return translateConstref(node);
    }
    assert.equal('variable', node.kind)
    if ('string' === typeof node.name) {
        let newName = scope.getVar(node.name);
        if (!newName) {
            newName = node.name;
        }
        return makeIdent(newName, node.loc);
    } else {
        return {
            type: "MemberExpression",
            object: makeIdent("global", node.loc),
            property: translateExpr(node.name, scope),
            computed: true,
            loc: translateLoc(node.loc),
        }
    }
}

function isArrayAppend(node) {
    return node.kind === 'offsetlookup' && (!node.offset || isArrayAppend(node.what));
}

function isVariableCreatingAssignment(node, scope) {
    if (node.operator === '=' && node.left.kind == 'variable' && 'string' === typeof node.left.name) {
        return !scope.getVar(node.left.name);
    }
    return false;
}

function translateAssignBlock(node, scope) {
    if (isVariableCreatingAssignment(node, scope)) {
        return makeVariableDeclaration(node.left.name, "var", translateExpr(node.right, scope), node.loc, scope);
    }
    return wrapInStatement(translateAssign(node, scope));
}

function makeNestedArray(node, valueJS, scope) {
    return {
        type: "ObjectExpression",
        loc: translateLoc(node.loc),
        properties: [
            makeArrayEntry(node.offset, valueJS, node.loc, scope),
        ],
    };
}

function translateArrayAppend(node, valueJS, scope) {
    if (node.offset) {
        return translateArrayAppend(node.what, makeNestedArray(node, valueJS, scope), scope);
    } else {
        return {
            type: "CallExpression",
            loc: translateLoc(node.loc),
            callee: {
                type: "MemberExpression",
                loc: translateLoc(node.loc),
                object: translateExpr(node.what, scope),
                property: makeIdent('push', node.loc),
            },
            arguments: [valueJS],
        };
    }
}

function translateAssign(node, scope) {
    assert(scope instanceof Scope);

    if (isArrayAppend(node.left)) {
        return translateArrayAppend(node.left, translateExpr(node.right, scope), scope);
    }

    if (isVariableCreatingAssignment(node, scope)) {
        scope.lazyDeclareVar(node.left.name);
    }

    const operator = node.operator === '.=' ? '+=' : node.operator
    return {
        type: "AssignmentExpression",
        operator,
        left: translateExpr(node.left, scope),
        right: translateExpr(node.right, scope),
        loc: translateLoc(node.loc),
    };
}

function translateInclude(node, scope) {
    assert(scope instanceof Scope);
    return {
        type: "CallExpression",
        callee: makeIdent("require", node.loc),
        arguments: [translateExpr(node.target, scope)],
    };
}

function translateThrow(node, scope) {
    assert(scope instanceof Scope);
    return {
        type: "ThrowStatement",
        argument: translateExpr(node.what, scope),
        loc: translateLoc(node.loc),
    };
}

function translateReturn(node, scope) {
    assert(scope instanceof Scope);
    return {
        type: "ReturnStatement",
        argument: translateExpr(node.expr, scope),
        loc: translateLoc(node.loc),
    };
}

function translateNamespace(node, scope) {
    assert(scope instanceof Scope);
    return {
        type: "BlockStatement",
        body: node.children.map(e => translateBlockLike(e, scope)),
        innerComments: [{
            type: "CommentLine",
            loc: translateLoc(node.loc),
            value: node.name.replace(/\\/g,'.'),
        }],
        loc: translateLoc(node.loc),
    };
}

function resolveIdent(node) {
    if (node.kind === 'constref') {
        return `\\${node.name}`; // TODO: not sure if right
    }

    if (node.kind !== 'identifier') return null;
    if (node.resolution === 'fqn') {
        return node.name;
    }
    return `\\${node.name}`; // TODO: proper namespacing
}

function isAlwaysCaught(what) {
    const ident = resolveIdent(what);
    return '\\Exception' === ident || '\\Throwable' === ident || '\\Error' === ident;
}

function makeExceptionInstanceCheck(what, outerVar, loc, scope) {
    assert(scope instanceof Scope);
    if (isAlwaysCaught(what)) {
        return {
            type: "BooleanLiteral",
            value: true,
            loc,
        };
    }
    return {
        type: "BinaryExpression",
        operator: "instanceof",
        loc: translateLoc(loc),
        left: outerVar,
        right: translateExpr(what, scope)
    }
}

function joinWithOperator(jsops, operator) {
    let node = jsops.pop();
    while(jsops.length) {
        const left = jsops.pop();
        node = {
            type: "BinaryExpression",
            operator,
            loc: translateLoc(left.loc),
            left,
            right: node,
        };
    }
    return node;
}

function makeLazyVariableDeclarations(vars, loc, scope) {
    if (!vars.length) return [];
    return [makeVariableDeclarations(vars, "var", undefined, loc, scope)];
}

function translateCatches(catches, loc, scope) {
    if (catches.length == 1 && catches[0].what.length == 1 && isAlwaysCaught(catches[0].what[0])) {
        const node = catches[0];
        scope.declareVar(node.variable.name);
        return {
            type: "CatchClause",
            body: translateBlockLike(node.body, scope),
            loc: translateLoc(node.loc),
            param: translateVariable(node.variable, scope, true),
        }
    }

    scope = scope.push();
    const vars = scope.captureLazyVars();

    const outerVarName = catches[0].variable.name;
    scope.declareVar(outerVarName);
    const outerVar = translateVariable(catches[0].variable, scope);

    const catchChecks = [];
    let alternate = null;
    while(catches.length) {
        const node = catches.pop();
        scope.declareVar(node.variable.name, outerVarName);
        const catchVar = translateVariable(node.variable, scope);
        const test = joinWithOperator(node.what.map(w => makeExceptionInstanceCheck(w, outerVar, node.variable.loc, scope)),"||");
        alternate = {
            type: "IfStatement",
            loc: translateLoc(node.loc),
            test,
            consequent: translateBlockLike(node.body, scope),
            alternate,
        };
    }
    return {
        type: "CatchClause",
        body: {
            type: "BlockStatement",
            loc: translateLoc(loc),
            body: makeLazyVariableDeclarations(vars, loc, scope).concat(alternate),
        },
        loc: translateLoc(loc),
        param: outerVar,
    }
}

function translateWhile(node, scope) {
    assert(scope instanceof Scope);
    return {
        type: "WhileStatement",
        loc: translateLoc(node.loc),
        test: translateExpr(node.test, scope),
        body: node.body ? translateBlockLike(node.body, scope) : null,
    }
}

function translateDoWhile(node, scope) {
    assert(scope instanceof Scope);
    return {
        type: "DoWhileStatement",
        loc: translateLoc(node.loc),
        test: translateExpr(node.test, scope),
        body: translateBlockLike(node.body, scope),
    }
}

function translateSwitch(node, scope) {
    return {
        type: "SwitchStatement",
        loc: translateLoc(node.loc),
        discriminant: translateExpr(node.test, scope),
        cases: node.body.children.map(node => ({
            type: "SwitchCase",
            loc: translateLoc(node.loc),
            test: translateExpr(node.test, scope),
            consequent: node.body ? translateBlockLike(node.body, scope).body : [],
        })),
    }
}

function translateTry(node, scope) {
    assert(scope instanceof Scope);
    return {
        type: "TryStatement",
        loc: translateLoc(node.loc),
        block: translateBlockLike(node.body, scope),
        handler: translateCatches(node.catches, node.loc, scope),
        // finalizer: node.always
    };
}

function addChildrenToBody(block, children, scope) {
    assert(Array.isArray(children));
    assert("body" in block);
    assert(scope instanceof Scope);

    const vars = scope.captureLazyVars();

    for(const node of children) {
        switch(node.kind) {
            case 'doc': addComments(block, node); break;
            default:
                block.body.push(translateBlockLike(node, scope));
        }
    }

    if (vars.length) {
        block.body = makeLazyVariableDeclarations(vars, block.loc, scope).concat(block.body);
    }
    return block;
}

function translateNamespacedString(parts, loc) {
    const name = parts.pop();
    if (!parts.length) {
        return {
            type: "Identifier",
            loc, name,
        };
    } else {
        return {
            type: "MemberExpression",
            object: translateNamespacedString(parts, loc),
            property: {
                type: "Identifier",
                loc, name,
            },
            computed: false,
        };
    }
}

function translateEcho(node, scope) {
    return wrapInStatement({
        type: "CallExpression",
        loc: translateLoc(node.loc),
        callee: makeIdent('echo'),
        arguments: node.arguments.map(e => translateExpr(e, scope)),
    });
}

function translateEval(node, scope) {
    return {
        type: "CallExpression",
        loc: translateLoc(node.loc),
        callee: makeIdent('eval'),
        arguments: [translateExpr(node.source, scope)],
    };
}

function translatePrint(node, scope) {
    return wrapInStatement({
        type: "CallExpression",
        loc: translateLoc(node.loc),
        callee: makeIdent('print'),
        arguments: [translateExpr(node.arguments, scope)],
    });
}

function translateInline(node, scope) {
    return wrapInStatement({
        type: "CallExpression",
        loc: translateLoc(node.loc),
        callee: makeIdent('echo'),
        arguments: [makeString(node.value, node.loc)],
    });
}

function translateIdent(node, scope) {
    assert.equal("identifier", node.kind, node);
    if (node.resolution === 'fqn') {
        return translateNamespacedString(['global'].concat(node.name.substring(1).split('\\')), node.loc)
    }
    if ('null' === node.name.toLowerCase()) {
        // PHP's `null` is returned from functions and is a placeholder for empty array elements.
        // so it matches `undefined` better.
        return makeIdent('undefined', node.loc);
    }
    return translateNamespacedString(node.name.split('\\'), node.loc);
}

function translateBinary(node, scope) {
    // TODO: use template literal? check if left is a string?
    const operator = node.type === '.' ? '+' : node.type;
    return {
        type: "BinaryExpression",
        operator,
        left: translateExpr(node.left, scope),
        right: translateExpr(node.right, scope),
        loc: translateLoc(node.loc),
    };
}

function makeNumber(value, loc) {
    return {
        type: "NumericLiteral",
        value: +value,
        extra: {raw: value},
        loc: translateLoc(loc),
    };
}

function escapeString(quote, str) {
    return str
            .replace(/\\/g,'\\\\')
            .replace(/\n/g,'\\n')
            .replace(/\r/g,'\\r')
            .replace(/\t/g,'\\t')
            .replace(quote == '"' ? /"/g : quote == '`' ? /`/g : /'/g, quote == '"' ? '\\"' : quote == '`' ? '\\`' : "'");
}

function makeString(value, loc, quote = '"') {
    return {
        type: "StringLiteral",
        value,
        raw: quote + escapeString(quote, value) + quote,
        loc: translateLoc(loc),
    };
}

function translateMagicConstant(node, scope) {
    switch(node.value) {
        case '__FILE__': return makeIdent("__filename", node.loc);
        case '__DIR__': return makeIdent("__dirname", node.loc);
        case '__LINE__': return makeNumber(node.loc.start.line, node.loc);
        case '__FUNCTION__':
        case '__CLASS__':
        case '__METHOD__ ':
            return makeString(scope.name || node.value, node.loc);
    }
}

function translateVariadic(node, scope) {
    return {
        type: "SpreadElement",
        loc: translateLoc(node.loc),
        argument: translateExpr(node.what, scope),
    };
}

function translateCast(node, scope) {
    switch(node.type) {
        case 'int':
        case 'float':
        case 'double':
        return {
            type: "UnaryExpression",
            operator:"+",
            prefix:true,
            loc: translateLoc(node.loc),
            argument: translateExpr(node.what, scope),
        };
        case 'boolean': return {
            type: "UnaryExpression",
            operator:"!",
            prefix:true,
            loc: translateLoc(node.loc),
            argument: {
                type: "UnaryExpression",
                operator:"!",
                prefix:true,
                loc: translateLoc(node.loc),
                argument: translateExpr(node.what, scope),
            },
        };
        case 'array': return {
            type: "CallExpression",
            loc: translateLoc(node.loc),
            callee: {
                type: "MemberExpression",
                loc: translateLoc(node.loc),
                object: makeIdent('Array', node.loc),
                property: makeIdent('from', node.loc),
                computed: false,
            },
            arguments: [translateExpr(node.what, scope)],
        };
        default: return {
            type: "CallExpression",
            loc: translateLoc(node.loc),
            callee: makeIdent(node.type[0].toUpperCase() + node.type.substring(1), node.loc),
            arguments: [translateExpr(node.what, scope)],
        }
    }
}

function translateExit(node, scope) {
    assert(scope instanceof Scope);
    return {
        type: "ThrowStatement",
        loc: translateLoc(node.loc),
        argument: {
            type: "CallExpression",
            loc: translateLoc(node.loc),
            callee: makeIdent("die", node.loc),
            arguments: [translateExpr(node.status, scope)],
        },
    };
}

function isIdentifierCompatibleString(node) {
    return node && node.kind === 'string' && /^[a-z_][a-z0-9_]*$/i.test(node.value);
}

function translateLookup(node, scope) {
    assert(scope instanceof Scope);
    let property, computed;
    if (isIdentifierCompatibleString(node.offset)) {
        computed = false;
        property = makeIdent(node.offset.value, node.offset.loc);
    } else if (node.offset) {
        computed = node.offset.kind !== 'constref' || 'string' !== typeof node.offset.name;
        property = translateExpr(node.offset, scope);
    } else {
        // This happens when arr[] is used as a reference. Not possible in JS :(
        return translateExpr(node.what, scope);
    }
    return {
        type: "MemberExpression",
        loc: translateLoc(node.loc),
        object: translateExpr(node.what, scope),
        property,
        computed,
    }
}

function translatePropLookup(node, scope) {
    if (node.what.kind === 'variable' && node.what.name === 'this') {
        return {
            type: "MemberExpression",
            loc: translateLoc(node.loc),
            object: {
                type: "ThisExpression",
                loc: translateLoc(node.what.loc),
            },
            property: translateExpr(node.offset, scope),
            computed: node.offset.kind !== 'constref' || 'string' !== typeof node.offset.name,
        };
    }
    return translateLookup(node, scope);
}

function translateStaticLookup(node, scope) {
    const name = resolveIdent(node.what);
    if ('\\parent' === name) {
        const sup = {
            type: "Super",
            loc: translateLoc(node.what.loc),
        };
        if ('\\__construct' === resolveIdent(node.offset)) {
            return sup;
        }
        return {
            type: "MemberExpression",
            loc: translateLoc(node.loc),
            object: sup,
            property: translateExpr(node.offset, scope),
            computed: node.offset.kind !== 'constref' || 'string' !== typeof node.offset.name,
        };
    }
    if ('\\self' === name) {
        const thisObj = {
            type: "ThisExpression",
            loc: translateLoc(node.loc),
        };
        const lookupObj = scope.isStaticMethod ? thisObj : {
            type: "MemberExpression",
            loc: translateLoc(node.loc),
            object: thisObj,
            property: makeIdent('constructor', node.loc),
            computed: false,
        };
        const offset = node.offset.curly ? node.offset.name : node.offset;
        return {
            type: "MemberExpression",
            loc: translateLoc(node.loc),
            object: lookupObj,
            property: translateExpr(offset, scope),
            computed: node.offset.curly,
        };
    }
    return translateLookup(node, scope);
}

function translateConst(node, scope) {
    return makeVariableDeclaration(node.name, "const", translateExpr(node.value, scope), node.loc, scope);
}

function translateConstref(node) {
    assert.equal("constref", node.kind);
    assert("name" in node);
    if ('string' === typeof node.name) {
        return makeIdent(node.name, node.loc);
    }
    return translateIdent(node.name);
}

function makeAnnotation(type, opts, loc) {
    if (opts && 'string' === typeof opts.id) {
        opts.id = makeIdent(opts.id, loc);
    }
    return Object.assign({
        type,
        loc: translateLoc(loc),
    }, opts);
}

function makeAmbiguousArrayAnnotation(loc) {
    const elementType = makeAnnotation("AnyTypeAnnotation", {optional: true}, loc);
    return makeAnnotation("UnionTypeAnnotation", {
        types: [
            makeAnnotation("ObjectTypeAnnotation", {exact: false, "properties": [], "indexers": [], "callProperties": []}, loc),
            makeAnnotation("ArrayTypeAnnotation", {exact: false, elementType}, loc),
        ],
    }, loc);
}

function translateTypeHint(node, nullable, scope) {
    let type = resolveIdent(node);
    let id,typeAnnotation;

    switch(type) {
        case '\\self':
            typeAnnotation = makeAnnotation("GenericTypeAnnotation", {id:scope.className}, node.loc);
            break;
        case '\\string':
            typeAnnotation = makeAnnotation("StringTypeAnnotation", undefined, node.loc);
            break;
        case '\\bool':
            typeAnnotation = makeAnnotation("BooleanTypeAnnotation", undefined, node.loc);
            break;
        case '\\float': case '\\int':
            typeAnnotation = makeAnnotation("NumberTypeAnnotation", undefined, node.loc);
            break;
        case '\\callable':
            typeAnnotation = makeAnnotation("GenericTypeAnnotation", {id:'Function'}, node.loc);
            break;
        case '\\iterable': // actual Iterator<T> seems to be broken
        case '\\array': {
            typeAnnotation = makeAmbiguousArrayAnnotation(node.loc);
            break;
        }
        case null:
            return undefined;
        default:
            typeAnnotation = makeAnnotation("GenericTypeAnnotation", {id:translateIdent(node, scope)}, node.loc);
    }

    if (nullable) {
        typeAnnotation = makeAnnotation("NullableTypeAnnotation", {typeAnnotation}, node.loc);
    }
    return makeAnnotation("TypeAnnotation", {typeAnnotation}, node.loc);
}

function isNullableParam(node) {
    return node.nullable || // php 7
        node.value && node.value.kind === 'constref' && node.value.name && node.value.name.kind === 'identifier' && node.value.name.name === 'null';
}

function translateParameter(node, scope) {
    assert(scope instanceof Scope);
    assert.equal('parameter', node.kind);
    scope.declareVar(node.name);
    const ident = makeIdent(node.name, node.loc);

    if (node.type) {
        ident.typeAnnotation = translateTypeHint(node.type, isNullableParam(node), scope);
    }
    if (node.value) {
        return {
            type: 'AssignmentPattern',
            loc: translateLoc(node.loc),
            left: ident,
            right: translateExpr(node.value, scope),
        }
    }
    return ident;
}

function translateClosure(node, scope) {
    assert(scope instanceof Scope);
    scope = scope.push({name: `closure_${scope.uid()}`, vars:{}});
    for(const u of node.uses) {
        scope.declareVar(u.name);
    }
    const params = node.arguments.map(e => translateParameter(e, scope));
    const body = translateBlockLike(node.body, scope);
    const generator = scope.isGenerator;
    return {
        type: generator ? "FunctionExpression" : "ArrowFunctionExpression",
        loc: translateLoc(node.loc),
        params,
        body,
        generator,
    }
}

function translateFunction(node, scope) {
    assert(scope instanceof Scope);
    scope = scope.push({name: node.name, vars:{}});
    const params = node.arguments.map(e => translateParameter(e, scope));
    const body = translateBlockLike(node.body, scope);
    return {
        type: "FunctionDeclaration",
        loc: translateLoc(node.loc),
        id: makeIdent(node.name, node.loc),
        params,
        generator: scope.isGenerator,
        body,
    }
}

function translateGlobalStatic(node, rename, scope) {
    const items = node.items.map(item => {
        const loc = translateLoc(item.loc);
        let name, right;
        if (item.kind === 'assign') {
            assert.equal('variable', item.left.kind);
            name = item.left.name;
            right = translateExpr(item.right, scope);
        } else {
            assert.equal('variable', item.kind);
            name = item.name;
            right = makeIdent('undefined', item.loc);
        }
        const newName = rename ? `_static_${scope.name || scope.uid()}_${name}` : name;
        scope.declareGlobalVar(name, newName);
        return {
            type: "IfStatement", loc,
            test: {
                type: "UnaryExpression",
                operator: "!", prefix:true,
                argument: {
                    type: "BinaryExpression", loc,
                    operator: "in",
                    left: makeString(newName, item.loc),
                    right: makeIdent('global', item.loc),
                },
            },
            consequent: wrapInStatement({
                type: "AssignmentExpression",
                operator: "=",
                left: makeIdent(newName, item.loc),
                right,
            }),
        };
    });
    if (items.length == 1) {
        return items[0];
    } else {
        return {
            type: "BlockStatement",
            loc: translateLoc(node.loc),
            body: items,
        };
    }
}

function makeVariableDeclaration(name, kind, init, loc, scope) {
    return makeVariableDeclarations([name], kind, init, loc, scope);
}

function makeVariableDeclarations(names, kind, init, loc, scope) {
    return {
        type: "VariableDeclaration",
        kind,
        declarations: names.map(name => {
            let id;
            if ('string' === typeof name) {
                let newName = scope.getVar(name);
                if (!newName) {
                    scope.declareVar(name);
                    newName = name;
                }
                id = makeIdent(newName, loc);
            } else {
                id = name;
            }
            return {
                type: "VariableDeclarator",
                id,
                loc: translateLoc(loc),
                init: init,
            };
        }),
        loc: translateLoc(loc),
    };
}

function isConstructor(node) {
    return node.name === '__construct';
}

function makeConstructor(params, body, loc) {
    return {
        type: "ClassMethod",
        kind: 'constructor',
        loc,
        key: makeIdent('constructor', loc),
        body,
        params,
    };
}

function translateClassMethod(node, scope) {
    scope = scope.push({name: node.name, vars:{}, isStaticMethod: node.isStatic});

    const isC = isConstructor(node);
    const params = node.arguments.map(e => translateParameter(e, scope));
    const body = translateBlockLike(node.body, scope);
    const loc = translateLoc(node.loc);

    return isC ? makeConstructor(params, body, loc) : {
        type: "ClassMethod",
        kind: 'method',
        loc,
        key: makeIdent(node.name, node.loc),
        body,
        params,
        static: node.isStatic,
        generator: scope.isGenerator,
    };
}

function wrapInStatement(expression) {
    return {
        type: "ExpressionStatement",
        loc: expression.loc,
        expression,
    };
}

function makeSuperConstructorCall(loc) {
    return {
        type: "CallExpression",
        loc: translateLoc(loc),
        callee: {
            type: "Super",
            loc: translateLoc(loc),
        },
        arguments: [{
            type: "SpreadElement",
            argument: makeIdent("arguments", loc),
        }],
    }
}

function translateClass(node, scope) {
    // node.implements
    // node.isAbstract
    // node.isFinal
    // node.isAnonymous

    scope = scope.push({name: node.name, className: node.name});

    const classBody = [];
    const instancePropInits = [];
    let constructor;

    const classDeclaration = {
        type: "ClassDeclaration",
        id: makeIdent(node.name, node.loc),
        superClass: node.extends ? translateIdent(node.extends) : undefined,
        loc: translateLoc(node.loc),
        body: {
            type: "ClassBody",
            loc: translateLoc(node.loc),
            body: classBody,
        },
    };

    for(const m of node.body) {
        switch(m.kind) {
            case 'doc':
                addComments(classDeclaration, m);
            break;
            case 'method': {
                if (m.body) { // Ignoring abstract
                    const method = translateClassMethod(m, scope);
                    if (isConstructor(m)) {
                        constructor = method;
                    }
                    classBody.push(method);
                }
                break;
            }
            case 'classconstant':
            case 'property':
                if (m.isStatic || 'classconstant' === m.kind) {
                    classBody.push({
                        type: "ClassProperty",
                        loc: translateLoc(m.loc),
                        key: makeIdent(m.name, m.loc),
                        static: true,
                        value: m.value ? translateExpr(m.value, scope) : null,
                    });
                } else if (m.value) {
                    instancePropInits.push(wrapInStatement({
                        type: "AssignmentExpression",
                        operator: "=",
                        loc: translateLoc(m.loc),
                        left: {
                            type: "MemberExpression",
                            loc: translateLoc(m.loc),
                            object: {
                                type: "ThisExpression",
                                loc: translateLoc(m.loc),
                            },
                            property: makeIdent(m.name, m.loc),
                            computed: false,
                        },
                        right: translateExpr(m.value, scope),
                    }));
                }
                break;
            default:
                console.warn("Class?", m);
        }
    }

    if (instancePropInits.length) {
        if (!constructor) {
            const body = {
                type: "BlockStatement",
                loc: translateLoc(node.loc),
                body: [],
            };
            if (node.extends) {
                body.body.push(wrapInStatement(makeSuperConstructorCall(node.loc)));
            }
            constructor = makeConstructor([], body, translateLoc(node.loc));
            classBody.unshift(constructor);
        }
        const body = constructor.body.body;
        const i = indexOfSuperCall(body);
        body.splice(i, 0, ...instancePropInits);
    }

    return classDeclaration;
}

function isSuperCall(nodeJS) {
    if (nodeJS.type === "ExpressionStatement") {
        return isSuperCall(nodeJS.expression);
    }
    return (nodeJS.type === "CallExpression" && nodeJS.callee.type === "Super");
}

function indexOfSuperCall(childrenJS) {
    for(let i=0; i < childrenJS.length; i++) {
        if (isSuperCall(childrenJS[i])) return i+1;
    }
    return 0;
}

function translateYield(node, delegate, scope) {
    scope.isGenerator = true;
    return {
        type: "YieldExpression",
        loc: translateLoc(node.loc),
        delegate,
        argument: node.key ? {
            type: "ArrayExpression",
            loc: translateLoc(node.loc),
            elements: [
                translateExpr(node.key, scope),
                translateExpr(node.value, scope),
            ],
        } : translateExpr(node.value, scope),
    };
}

function translateClone(node, scope) {
    assert(scope instanceof Scope);
    return {
        type: "CallExpression",
        loc: translateLoc(node.loc),
        callee: makeIdent('clone', node.loc),
        arguments: [translateExpr(node.what, scope)],
    }
}

function translateHalt(node, scope) {
    assert(scope instanceof Scope);
    return wrapInStatement({
        type: "CallExpression",
        loc: translateLoc(node.loc),
        callee: makeIdent("__halt_compiler", node.loc),
        arguments: [makeString(node.after, node.loc, "'")],
    });
}

function translateCall(node, scope) {
    assert(scope instanceof Scope);
    return {
        type: "CallExpression",
        loc: translateLoc(node.loc),
        callee: translateExpr(node.what, scope),
        arguments: node.arguments.map(a => translateExpr(a, scope)),
    }
}

function translateIsset(node, scope) {
    return joinWithOperator(node.arguments.map(node => {
        return {
            type: "BinaryExpression",
            operator: "!==",
            loc: translateLoc(node.loc),
            left: makeIdent('undefined'),
            right: translateExpr(node, scope),
        };
    }), '&&');
}

function translateUnset(node, scope) {
    return {
        type: "UnaryExpression",
        loc: translateLoc(node.loc),
        operator: "delete",
        prefix:true,
        argument: translateExpr(node.arguments[0], scope),
    }
}

function translateEmpty(node, scope) {
    return {
        type: "UnaryExpression",
        operator: '!',
        prefix: true,
        argument: translateExpr(node.arguments[0], scope),
    }
}

function makeEmptyTemplate(tail) {
    return {
        type: "TemplateElement",
        value: {
            raw: "",
            cooked: "",
        },
        tail,
    };
}

function translateEncapsed(node, scope) {
    assert(scope instanceof Scope);
    const out = {
        type: "TemplateLiteral",
        quasis: [],
        expressions: [],
        loc: translateLoc(node.loc),
    };
    let lastOneWasExpr = true;
    for(let val of node.value) {
        if (val.kind === 'string') {
            lastOneWasExpr = false;
            out.quasis.push({
                type: "TemplateElement",
                value: {
                    raw: escapeString('`', val.value),
                    cooked: val.value,
                },
                loc: translateLoc(val.loc),
            });
        } else {
            if (lastOneWasExpr) {
                out.quasis.push(makeEmptyTemplate(false));
            }
            lastOneWasExpr = true;
            out.expressions.push(translateExpr(val, scope));
        }
    }
    if (lastOneWasExpr) {
        out.quasis.push(makeEmptyTemplate(true));
    } else {
        out.quasis[out.quasis.length-1].tail = true;
    }
    return out;
}

function translateUpdate(node, prefix, scope) {
    return {
        type: "UpdateExpression",
        loc: translateLoc(node.loc),
        operator: `${node.type}${node.type}`,
        prefix,
        argument: translateExpr(node.what, scope),
    };
}

function translateNew(node, scope) {
    return {
        type: "NewExpression",
        loc: translateLoc(node.loc),
        callee: translateExpr(node.what, scope),
        arguments: node.arguments.map(e => translateExpr(e, scope)),
    };
}

function translateList(node, scope) {
    return {
        type: "ArrayPattern",
        loc: translateLoc(node.loc),
        elements: node.arguments.map(e => {
            if (!e) return null;
            if (e.kind === 'variable') {
                if (!scope.getVar(e.name)) scope.lazyDeclareVar(e.name);
            }
            return translateExpr(e, scope);
        }),
    }
}

function translateExpr(node, scope) {
    assert(scope instanceof Scope);
    if (!node) return null;

    switch(node.kind) {
        case 'variable': return translateVariable(node, scope);
        case 'array': return translateArray(node, scope);
        case 'pre': return translateUpdate(node, true, scope);
        case 'post': return translateUpdate(node, false, scope);
        case 'new': return translateNew(node, scope);
        case 'boolean': return {
            type: "BooleanLiteral",
            loc: translateLoc(node.loc),
            value: node.value,
        };
        case 'number': return makeNumber(node.value, node.loc);
        case 'exit': return translateExit(node, scope);
        case 'bin': return translateBinary(node, scope);
        case 'clone': return translateClone(node, scope);
        case 'yield': return translateYield(node, false, scope);
        case 'yieldfrom': return translateYield(node, true, scope);
        case 'eval': return translateEval(node, scope);
        case 'cast': return translateCast(node, scope);
        case 'variadic': return translateVariadic(node, scope);
        case 'magic': return translateMagicConstant(node, scope);
        case 'closure': return translateClosure(node, scope);
        case 'list': return translateList(node, scope);
        case 'propertylookup': return translatePropLookup(node, scope);
        case 'offsetlookup': return translateLookup(node, scope);
        case 'constref': return translateConstref(node, scope);
        case 'staticlookup': return translateStaticLookup(node, scope);
        case 'identifier': return translateIdent(node, scope);
        case 'retif': return translateTernary(node, scope);
        case 'assign': return translateAssign(node, scope);
        case 'string': return makeString(node.value, node.loc, node.isDoubleQuote ? '"' : "'");
        case 'nowdoc': return makeString(node.value, node.loc, node.isDoubleQuote ? '"' : "'");
        case 'call': return translateCall(node, scope);
        case 'isset': return translateIsset(node, scope);
        case 'empty': return translateEmpty(node, scope);
        case 'unset': return translateUnset(node, scope);
        case 'class': return translateClass(node, scope);
        case 'interface': return null;
        case 'silent': return translateExpr(node.expr, scope);
        case 'function': return translateFunction(node, scope);
        case 'encapsed': return translateEncapsed(node, scope);
        case 'include': return translateInclude(node, scope);
        case 'unary': return {
            type: "UnaryExpression",
            operator: node.type,
            loc: translateLoc(node.loc),
            argument: translateExpr(node.what, scope),
        };
        case 'parenthesis': return translateExpr(node.inner, scope);
        default:
            console.warn("expr?", node)
    }
}

function translateBlockLike(node, scope) {
    assert(scope instanceof Scope);
    switch(node.kind) {
        case "block":
            return addChildrenToBody({
                type: "BlockStatement",
                loc: translateLoc(node.loc),
                body: [],
            }, node.children, scope);
        case 'if': return translateIf(node, scope);
        case 'foreach': return translateForeach(node, scope);
        case 'for': return translateFor(node, scope);
        case 'throw': return translateThrow(node, scope);
        case 'continue': return {type: "ContinueStatement", loc: translateLoc(node.loc)};
        case 'break': return {type: "BreakStatement", loc: translateLoc(node.loc)};
        case 'while': return translateWhile(node, scope);
        case 'do': return translateDoWhile(node, scope);
        case 'switch': return translateSwitch(node, scope);
        case 'try': return translateTry(node, scope);
        case 'return': return translateReturn(node, scope);
        case 'namespace': return translateNamespace(node, scope);
        case 'echo': return translateEcho(node, scope);
        case 'print': return translatePrint(node, scope);
        case 'inline': return translateInline(node, scope);
        case 'exit': return translateExit(node, scope);
        case 'constant': return translateConst(node, scope);
        case 'assign': return translateAssignBlock(node, scope);
        case 'static': return translateGlobalStatic(node, true, scope);
        case 'global': return translateGlobalStatic(node, false, scope);
        case 'halt': return translateHalt(node, scope);
        default: {
            const expression = translateExpr(node, scope);
            if (expression) {
                return wrapInStatement(expression);
            }
        }
    }
}

function prependJSBlock(blockJs, node) {
    if ('BlockStatement' === blockJs.type) {
        blockJs.body.unshift(node);
        return blockJs;
    }
    return {
        type: "BlockStatement",
        loc: translateLoc(node.loc),
        body: [node, blockJs],
    };
}

function isQuickWithNoSideEffects(node) {
    return node.kind === 'variable';
}

function makeComma(expressions, loc, scope) {
    return {
        type: "SequenceExpression",
        loc: translateLoc(loc),
        expressions: expressions.map(e => translateExpr(e, scope)),
    };
}

function translateFor(node, scope) {
    return {
        type: "ForStatement",
        loc: translateLoc(node.loc),
        init: node.init.length == 1 && node.init[0].kind === 'assign' ? translateAssignBlock(node.init[0], scope) : makeComma(node.init, node.loc, scope),
        test: makeComma(node.test, node.loc, scope),
        update: makeComma(node.increment, node.loc, scope),
        body: node.body ? translateBlockLike(node.body, scope) : undefined,
    };
}

function isArrayLiteral(node) {
    return node.kind === 'array';
}

function translateForeach(node, scope) {
    assert(scope instanceof Scope);
    const valueVar = translateVariable(node.value, scope);
    let source = translateExpr(node.source, scope);
    const body = translateBlockLike(node.body, scope);
    if (node.key) {
        let beforeLoop;
        if (!isQuickWithNoSideEffects(node.source)) {
            const tempName = `_tmp_${scope.uid()}`;
            beforeLoop = makeVariableDeclaration(tempName, "let", source, node.value.loc, scope);
            source = makeIdent(tempName, node.value.loc);
        }

        const keyVar = translateVariable(node.key, scope);
        const readValue = {
            type: "MemberExpression",
            loc: translateLoc(node.key.loc),
            object: source,
            property: keyVar,
            computed: true,
        };
        const forIn = {
            type: "ForInStatement",
            loc: translateLoc(node.loc),
            body: prependJSBlock(body, makeVariableDeclaration(valueVar, "var", readValue, node.key.loc, scope)),
            left: makeVariableDeclaration(keyVar, "var", null, node.key.loc, scope),
            right: source,
        };
        if (beforeLoop) {
            return {
                type: "BlockStatement",
                loc: translateLoc(node.loc),
                body: [beforeLoop, forIn],
            };
        } else {
            return forIn;
        }
    }

    if (!isArrayLiteral(node.source)) {
        source = {
            type: "CallExpression",
            loc: translateLoc(node.source.loc),
            callee: {
                type: "MemberExpression",
                loc: translateLoc(node.source.loc),
                object: makeIdent('Object', node.source.loc),
                property: makeIdent('values', node.source.loc),
            },
            arguments: [source],
        };
    }

    return {
        type: "ForOfStatement",
        loc: translateLoc(node.loc),
        body,
        left: makeVariableDeclaration(valueVar, "var", null, node.value.loc, scope),
        right: source,
    };
}

function translateIf(node, scope) {
    assert(scope instanceof Scope);
    return {
        type: "IfStatement",
        loc: translateLoc(node.loc),
        test: translateExpr(node.test, scope),
        consequent: node.body ? translateBlockLike(node.body, scope) : {
                type: "BlockStatement",
                loc: translateLoc(node.loc),
                body: [],
        },
        alternate: node.alternate ? translateBlockLike(node.alternate, scope) : undefined,
    };
}

function translateTernary(node, scope) {
    assert(scope instanceof Scope);
    const test = translateExpr(node.test, scope);
    return {
        type: "ConditionalExpression",
        loc: translateLoc(node.loc),
        test,
        consequent: node.trueExpr ? translateExpr(node.trueExpr, scope) : test,
        alternate: translateExpr(node.falseExpr, scope),
    };
}

function lineComment(value, loc) {
    return {
        type: "CommentLine",
        loc,
        value: value.replace(/^\s*\*+/g, ''),
    };
}

function addComments(jsNode, phpNode) {
    if (!jsNode.leadingComments) jsNode.leadingComments = [];
    if (!jsNode.innerComments) jsNode.innerComments = [];
    for(const comment of phpNode.lines) {
        const lines = comment.split(/[\r\n]+/gm);
        for(const line of lines) {
          jsNode.leadingComments.push(lineComment(line, translateLoc(phpNode.loc)));
        }
    }
}
