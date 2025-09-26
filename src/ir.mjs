import { Where } from './tokens.mjs';
import * as Types from './types.mjs';
import * as Syntax from './syntax.mjs';
import assert from 'assert';

export class Instructions extends Array {
    /**
     * @param {Syntax.Project} project 
     * @param {(number: number) => [Types.Type[], Types.Type]} getSyscallTypes 
     */
    constructor(project, getSyscallTypes) {
        super();

        /** @type {Syntax.FunctionDeclaration[]} */
        const functions = [];
        /** @type {Types.Type[]} */
        const functionTypes = [];
        /** @type {Bindings[]} */
        const functionScopes = [];

        let locals = [];
        let localTypes = [];

        /** @type {(self, scope: Bindings) => Types.Type} */
        const getType = (self, scope) => {
            if (self instanceof Syntax.Typename) {
                const bound = scope.get(self.binding, self.where);
                if (!(bound instanceof Types.Type))
                    self.where.error(`name '${self.binding}' does not refer to a type`);
                return bound;
            } else if (self instanceof Syntax.PointerType) {
                return Types.ptr(getType(self.pointee, scope));
            } else if (self instanceof Syntax.ObjectType) {
                return Types.obj(Object.fromEntries(Object.entries(self.members).map(([k, v]) => {
                    return [k, getType(v, scope)];
                })), self.visibilities);
            } else if (self instanceof Syntax.TupleType) {
                return Types.tuple(self.members.map(member => getType(member, scope)));
            } else {
                console.log(self);
                throw new Error(`unimpl`);
            }
        };

        /** @type {(src: Types.Type, dst: Types.Type, where: Where, explicit: boolean) => Types.Type} */
        const expectOrConvertType = (src, dst, where, explicit) => {
            assert(src);

            if (src === dst || !dst)
                return src;

            if (src.referee === dst) {
                this.push(new ReadValue());
                return dst;
            }

            if (
                src.object && dst.object &&
                src.members.length === dst.members.length &&
                Object.entries(src.properties).every(([property, type], i) => 
                    Object.entries(dst.properties)[i][0] === property &&
                    Object.entries(dst.properties)[i][1] === type
                )
            ) {
                if (src.visibilities.includes('private'))
                    where.error(`cannot use type '${src}' to construct another type because it has private properties`);
                if (dst.visibilities.includes('private'))
                    where.error(`cannot construct type '${dst}' because it has private properties`);

                return dst;
            }

            if (
                src.tuple && dst.object &&
                src.members.every((member, i) => member === dst.members[i])
            ) {
                if (dst.visibilities.includes('private'))
                    where.error(`cannot construct type '${dst}' because it has private properties`);

                return dst;
            }

            if ((dst.integral || dst.scalar)) {
                if (src.integral || src.scalar) {
                    this.push(new NumericCast(dst));
                    return dst;
                } else if (src.referee && (src.referee.integral || src.referee.scalar)) {
                    this.push(
                        new ReadValue(),
                        new NumericCast(dst)
                    );
                    return dst;
                }
            }

            where.error(`expected type '${dst}' but found '${src.referee ? src.referee : src}'`);
        };

        /** @type {(self: Syntax.Tagmeme, scope: Bindings, expected?: Types.Type, explicit?: boolean) => Types.Type} */
        const generateExpression = (self, scope, expected = null, explicit = false) => {
            /** @type {Types.Type} */
            let result;

            if (self instanceof Syntax.Tuple) {
                if (
                    expected && (
                        (expected.tuple && expected.members.length != self.values.length) ||
                        (expected.object && expected.members.length != self.values.length)
                    )
                )
                    self.where.error(`expected ${expected.members.length} values, found ${self.values.length}`);

                this.push(null);
                result = Types.tuple(self.values.map((member, index) => {
                    const expectedType = (expected && expected.tuple && expected.members[index]) ||
                        (expected && expected.object && expected.members[index]);
                    const type = generateExpression(member, scope, expectedType);
                    this.push(new StoreMember(index));
                    return type;
                }));
                this[this.indexOf(null)] = new BeginAggregate(result);
            } else if (self instanceof Syntax.Index) {
                const lhs = generateExpression(self.lhs, scope);
                if (lhs.tuple) {
                    if (self.rhs.value >= lhs.members.length) {
                        self.rhs.where.error(`tuple index out of bounds`);
                    }
                    result = lhs.members[self.rhs.value];
                    this.push(
                        new PushTopReference(),
                        new OffsetReferenceToMember(self.rhs.value),
                        new ReadValue(),
                        new Rotate(),
                        new Pop(),
                    );
                } else if (lhs.reference && lhs.referee.tuple) {
                    if (self.rhs.value >= lhs.referee.members.length)
                        self.rhs.where.error(`tuple index out of bounds`);
                    result = lhs.referee.members[self.rhs.value];
                    this.push(
                        new OffsetReferenceToMember(self.rhs.value),
                        new ReadValue(),
                    );
                } else {
                    console.log(lhs);
                    throw new Error();
                }
            } else if (self instanceof Syntax.Cast) {
                const type = getType(self.rhs, scope);
                const lhs = generateExpression(self.lhs, scope, type, true);
                assert (lhs === type);
                result = type;
            } else if (self instanceof Syntax.ObjectLiteral) {
                if (expected && expected.object && expected.members.length != Object.values(self.members).length) {
                    self.where.error(`expected ${expected.members.length} properties, found ${Object.values(self.members).length}`);
                } 

                this.push(null);
                result = Types.obj(Object.fromEntries(
                    Object.entries(self.members).map(([name, expression], index) => {
                        const expectedName = expected && expected.object && Object.entries(expected.properties)[index][0];

                        if (expectedName && expectedName != name) {
                            self.where.error(`expected property '${expectedName}' but found '${name}'`);
                        }
                        
                        const type = expected && expected.object ?
                            expected.members[index] : null;

                        const property = [name, generateExpression(expression, scope, type)];
                        this.push(new StoreMember(index));
                        return property;
                    }
                )), new Array(Object.values(self.members).length).fill('public'));
                this[this.indexOf(null)] = new BeginAggregate(result);
            } else if (self instanceof Syntax.Integer) {
                if (!expected) {
                    self.where.error(`unable to determine type of integer literal`);
                } else if (expected.integral) {
                    result = expected;
                    this.push(new PushInteger(result, self.value));
                } else if (expected.scalar) {
                    result = expected;
                    this.push(new PushScalar(result, self.value));
                } else if (expected.reference && expected.referee.integral) {
                    result = expected.referee;
                    this.push(new PushInteger(result, self.value));
                } else {
                    console.log(self);
                    console.log(expected);
                    self.where.error(`unimplemented`);
                }
            } else if (self instanceof Syntax.Scalar) {
                if (!expected) {
                    self.where.error(`invalid context for scalar literal`);
                } else if (expected.scalar) {
                    result = expected;
                    this.push(new PushScalar(result, self.value));
                } else {
                    console.log(self);
                    self.where.error(`unimplemented`);
                }
            } else if (self instanceof Syntax.Syscall) {
                if (self.arguments.length == 0) self.where.error(
                    `expected at least one argument`
                );
                if (!(self.arguments[0] instanceof Syntax.Integer)) self.where.error(
                    `expected the first argument of a syscall to be an integer literal`
                );

                const [inputs, output] = getSyscallTypes(self.arguments[0].value);
                if (self.arguments.length != inputs.length) self.where.error(
                    `expected ${inputs.length} arguments, but found ${self.arguments.length}`
                );
                self.arguments.forEach((arg, i) => generateExpression(arg, scope, inputs[i]));
                result = output;
                this.push(
                    new Syscall(self.arguments.length),
                    new PushSyscallReturnValue(result)
                );
            } else if (self instanceof Syntax.Call) {
                const lhs = generateExpression(self.lhs, scope);
                if (!lhs.callable) self.lhs.where.error(
                    `type '${lhs}' is not callable`
                );
                if (self.arguments.length != lhs.inputs.length) self.where.error(
                    `expected ${lhs.inputs.length} arguments, but found ${self.arguments.length}`
                );
                self.arguments.forEach((arg, i) => generateExpression(arg, scope, lhs.inputs[i]));
                result = lhs.output;
                this.push(
                    new Call(self.arguments.length, lhs),
                    new PushReturnValue(result)
                );
            } else if (self instanceof Syntax.Access) {
                const lhs = generateExpression(self.lhs, scope);
                if (lhs.module) {
                    /** @type {Syntax.Module} */ const module = lhs.module;
                    const what = module.exports.find(e => e.binding === self.rhs.value);
                    if (!what)
                        self.rhs.where.error(`module does not export the name '${self.rhs.value}'`);
                    else if (what instanceof Syntax.FunctionDeclaration) {
                        const index = functions.indexOf(what);
                        assert(index != -1);
                        result = functionTypes[index];
                        assert(result);
                        this.push(new PushFunctionAddress(index, result));
                    } else {
                        console.log(what);
                        self.rhs.where.error(`unimplemented`);
                    }
                } else if (lhs.object) {
                    if (!(self.rhs.value in lhs.properties)) self.rhs.where.error(
                        `property '${self.rhs.value}' does not exist in type '${lhs}'`
                    );
                    result = lhs.properties[self.rhs.value];
                    this.push(
                        new PushTopReference(),
                        new OffsetReferenceToMember(Object.keys(lhs.properties).indexOf(self.rhs.value)),
                        new ReadValue(),
                        new Rotate(),
                        new Pop(),
                    );
                } else if (lhs.reference && lhs.referee.object) {
                    if (!(self.rhs.value in lhs.referee.properties)) self.rhs.where.error(
                        `property '${self.rhs.value}' does not exist in type '${lhs.referee}'`
                    );
                    result = lhs.referee.properties[self.rhs.value];
                    this.push(
                        new OffsetReferenceToMember(Object.keys(lhs.referee.properties).indexOf(self.rhs.value)),
                        new ReadValue(),
                    );
                } else {
                    console.log(lhs);
                    self.where.error(`unimplemented`);
                }
            } else if (self instanceof Syntax.Binding) {
                const bound = scope.get(self.value, self.where);
                if (bound instanceof Syntax.Module) {
                    result = Types.module(bound);
                } else if (bound instanceof Syntax.FunctionDeclaration) {
                    const index = functions.indexOf(bound);
                    assert(index != -1);
                    result = functionTypes[index];
                    assert(result);
                    this.push(new PushFunctionAddress(index, result));
                } else if (bound instanceof Syntax.Parameter || bound instanceof Syntax.LocalDeclaration) {
                    const index = locals.indexOf(bound);
                    assert(index != -1);
                    result = Types.ref(localTypes[index]);
                    this.push(new PushLocalReference(index));
                } else {
                    console.log(bound);
                    self.where.error(`unimplemented`);
                }
            } else if (
                self instanceof Syntax.Sum || 
                self instanceof Syntax.Difference ||
                self instanceof Syntax.Product ||
                self instanceof Syntax.Quotient
            ) {
                const lhs = generateExpression(self.lhs, scope, expected);
                const rhs = generateExpression(self.rhs, scope, lhs);

                if (lhs != rhs) {
                    self.where.error(`type mismatch between left and right-hand sides`);
                } else if (!lhs.arithmetic) {
                    self.where.error(`type '${lhs}' is not arithmetic`);
                }

                result = lhs;
                if (self instanceof Syntax.Sum)
                    this.push(new PushSum(result));
                else if (self instanceof Syntax.Difference)
                    this.push(new PushDifference(result));
                else if (self instanceof Syntax.Product) 
                    this.push(new PushProduct(result));
                else if (self instanceof Syntax.Quotient)
                    this.push(new PushQuotient(result));
                else
                    throw new Error();
            } else if (
                self instanceof Syntax.Less ||
                self instanceof Syntax.Lequal
            ) {
                let lhs = generateExpression(self.lhs, scope);
                if (lhs.reference) {
                    this.push(new ReadValue());
                    lhs = lhs.referee;
                }
                const rhs = generateExpression(self.rhs, scope, lhs);

                if (lhs != rhs) {
                    self.where.error(`type mismatch between left and right-hand sides`);
                } else if (!lhs.arithmetic) {
                    self.where.error(`type '${lhs}' is not arithmetic`);
                }

                result = Types.bool;
                if (self instanceof Syntax.Less)
                    this.push(new CmpLt(lhs));
                else if (self instanceof Syntax.Lequal)
                    this.push(new CmpLe(lhs));
            } else if (self instanceof Syntax.Equality) {
                let lhs = generateExpression(self.lhs, scope);
                if (lhs.reference) {
                    this.push(new ReadValue());
                    lhs = lhs.referee;
                }
                const rhs = generateExpression(self.rhs, scope, lhs);

                if (lhs != rhs) {
                    self.where.error(`type mismatch between left and right-hand sides`);
                }

                result = Types.bool;
                this.push(new CmpEq(lhs));
            } else {
                console.log(this);
                console.log(self);
                console.log(expected);
                self.where.error(`unimplemented`);
            }

            return expectOrConvertType(result, expected, self.where, explicit);
        };

        let labelIndex = 0;

        /** @type {(self: Syntax.Scope, parent?: Bindings, expected?: Types.Type) => void} */
        const generateScope = (self, parent = null, expected = null) => {
            const scope = new Bindings(
                parent,
                self instanceof Syntax.FunctionDeclaration
            );

            self.types.forEach(type => {
                scope.bind(type.binding, Types.def(getType(type.type, scope), type.binding), type.where);
            });

            self.functions.forEach(func => {
                assert(!functions.includes(func));
                functions.push(func);
                functionTypes.push(Types.fn(
                    func.parameters.map(p => getType(p.type, scope)),
                    func.type ? getType(func.type, scope) : Types.none
                ));
                functionScopes.push(scope);
                scope.bind(func.binding, func, func.where);
            });

            if (self instanceof Syntax.FunctionDeclaration) {
                self.parameters.forEach(param => {
                    scope.bind(param.binding, param, param.where);
                    locals.push(param);
                    localTypes.push(getType(param.type, scope));
                    this.push(new ReserveParameter(localTypes[localTypes.length - 1]));
                });
            }

            self.statements.forEach(stat => {
                if (stat instanceof Syntax.ModuleImport) {
                    const module = project.modules.find(m => m.where.path === stat.from);
                    scope.bind(stat.binding, module, stat.where);
                } else if (stat instanceof Syntax.BoundImport) {
                    const module = project.modules.find(m => m.where.path === stat.from);
                    const what = module.exports.find(e => e.binding === stat.name);
                    if (!what) stat.where.error(`module does not export the name '${stat.name}'`);
                    scope.bind(stat.binding, what, stat.where);
                } else if (stat instanceof Syntax.Expression) {
                    generateExpression(stat.value, scope);
                    this.push(new Pop());
                } else if (stat instanceof Syntax.Return) {
                    if (expected === null) {
                        stat.where.error(`invalid context for return statement`);
                    }
                    generateExpression(stat.value, scope, expected);
                    this.push(new Return(expected));
                } else if (stat instanceof Syntax.Condition) {
                    generateExpression(stat.condition, scope, Types.bool);
                    this.push(new JumpIfFalse(labelIndex));
                    generateScope(stat, scope, expected);
                    this.push(new Label(labelIndex++));
                    stat.alternatives.forEach(alternative => {
                        if (alternative.condition) {
                            generateExpression(alternative.condition, scope, Types.bool);
                            this.push(new JumpIfFalse(labelIndex));
                        }
                        generateScope(alternative, scope, expected);
                        if (alternative.condition) {
                            this.push(new Label(labelIndex++));
                        }
                    });
                } else if (stat instanceof Syntax.LocalDeclaration) {
                    const type = generateExpression(stat.value, scope);
                    if (type === Types.never || type === Types.none)
                        stat.where.error(`cannot instantiate local variable with type '${type}'`);
                    locals.push(stat);
                    localTypes.push(type);
                    scope.bind(stat.binding, stat, stat.where);
                } else {
                    console.log(scope);
                    console.dir(stat, {depth: null});
                    stat.where.error(`unimplemented`);
                }
            });
        };

        this.push(new Startup());
        this.push(new Shutdown());

        project.modules.forEach((module, i) => {
            locals = [];
            localTypes = [];
            this.push(new Prologue(`module${i}`));
            generateScope(module);
            this.push(new Epilogue());
        });

        let compiled = -1;
        while (++compiled != functions.length) {
            locals = [];
            localTypes = [];
            this.push(new Prologue(compiled));
            generateScope(functions[compiled], functionScopes[compiled], functionTypes[compiled].output);
            this.push(new Epilogue());
        }
    }
}

export class Startup {}
export class Shutdown {}
export class Prologue { constructor(index) {this.index = index} }
export class Epilogue {}
export class Call { constructor(argc, type) {this.argc = argc; this.type = type} }
export class Pop {}
export class PushReturnValue { constructor(type) {this.type = type} }
export class Syscall { constructor(argc) {this.argc = argc} }
export class PushSyscallReturnValue { constructor(type) {this.type = type} }
export class PushFunctionAddress { constructor(index, type) {this.index = index; this.type = type}}
export class PushInteger { constructor(type, value) {this.type = type; this.value = value} }
export class PushScalar { constructor(type, value) {this.type = type; this.value = value} }
export class PushLocalReference { constructor(index) {this.index = index}}
export class PushTopReference {}
export class Return { constructor(type) {this.type = type} }
export class PushSum { constructor(type) {this.type = type} }
export class PushDifference { constructor(type) {this.type = type} }
export class PushProduct { constructor(type) {this.type = type} }
export class PushQuotient { constructor(type) {this.type = type} }
export class OffsetReferenceToMember { constructor(index) {this.index = index} }
export class Rotate {}
export class ReadValue {}
export class ReserveParameter { constructor(type) {this.type = type} }
export class BeginAggregate { constructor(type) {this.type = type} }
export class StoreMember { constructor(index) {this.index = index} }
export class Label { constructor(index) {this.index = index} }
export class JumpToLabel { constructor(index) {this.index = index} }
export class JumpIfFalse { constructor(index) {this.index = index} }
export class CmpLt { constructor(type) {this.type = type} }
export class CmpLe { constructor(type) {this.type = type} }
export class CmpEq { constructor(type) {this.type = type} }
export class NumericCast { constructor(type) {this.type = type} }

class Bindings {
    /**
     * @typedef {object}    Binding
     * @property {Where}    where
     * @property {any}      what
     * @property {Bindings} scope
     */

    static builtins = {
        u8:     Types.u8,
        u16:    Types.u16,
        u32:    Types.u32,
        u64:    Types.u64,
        usz:    Types.usz,
        s8:     Types.s8,
        s16:    Types.s16,
        s32:    Types.s32,
        s64:    Types.s64,
        ssz:    Types.ssz,
        f32:    Types.f32,
        f64:    Types.f64,
        bool:   Types.bool,
        none:   Types.none,
        never:  Types.never,
    };

    /** @param {Bindings} parent  */
    constructor(parent = null, isFunction = false) {
        /** @type {{[name: string]: Binding}} */
        this.names = parent ? {...parent.names} : {};
        if (isFunction) {
            for (const [name, binding] of Object.entries(this.names)) {
                if (binding instanceof Syntax.LocalDeclaration)
                    delete this.names[name];
            }
        }
    }
    
    /**
     * @param {string} name 
     * @param {Where} where 
     */
    assertUnbound(name, where) {
        if (name in Bindings.builtins) {
            where.error(`cannot bind to builtin name '${name}'`);
        }
        if (name in this.names && this.names[name].scope === this) {
            where.error(`name '${name}' is already bound in this scope`);
        }
    }

    /**
     * @param {string} name 
     * @param {any} what 
     * @param {Where} where 
     */
    bind(name, what, where) {
        this.assertUnbound(name, where);
        this.names[name] = {where, what, scope: this};
    }

    /**
     * @param {string} name 
     * @param {Where} where 
     * @returns {any | never}
     */
    get(name, where) {
        if (name in Bindings.builtins)
            return Bindings.builtins[name];
        if (name in this.names)
            return this.names[name].what;
        where.error(`undefined reference to unbound name '${name}'`);
    }
}
