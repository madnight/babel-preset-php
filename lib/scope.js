
module.exports = class Scope {
    constructor() {
        this.shared = {uid:0};
        this.globals = {};
        this.vars = {}
        this.lazyVars = [];
    }

    push(newState = {}) {
        if (newState.name && this.name) {
            if ('string' !== typeof newState.name) throw Error("Bad fn name");
            newState.name = `${this.name}_${newState.name}`;
        }
        return Object.assign(Object.create(this), newState);
    }

    getVar(name) {
        if ('string' !== typeof name) throw Error("Bad var name");
        return this.vars[name] || this.globals[name]
    }

    uid() {
        return this.shared.uid++;
    }

    declareGlobalVar(name, newName = name) {
        if ('string' !== typeof name) throw Error("Bad var name");
        if ('string' !== typeof newName) throw Error("Bad var name");
        this.globals[name] = newName;
    }

    lazyDeclareVar(name, newName = name) {
        this.lazyVars.push(name);
        this.declareVar(name, newName);
    }

    captureLazyVars() {
        const vars = [];
        this.lazyVars = vars;
        return vars;
    }

    declareVar(name, newName = name) {
        if ('string' !== typeof name) throw Error("Bad var name");
        if ('string' !== typeof newName) throw Error("Bad var name");
        // Must be immutable to avoid contaminating other scopes
        this.vars = Object.assign({}, this.vars, {[name]:newName});
    }
}
