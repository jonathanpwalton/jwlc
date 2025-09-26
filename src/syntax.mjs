import { dirname } from 'path';
import { existsSync } from 'fs';
import { Tokens, Where } from './tokens.mjs';
import * as Token from './tokens.mjs';

export class Project {
    /** @type {Module[]} */ modules = [];

    /** @param {string} path  */
    constructor(path) {
        this.path = path;
        
        const parsed = [];

        const parseModule = (path) => {
            if (parsed.includes(path)) return;
            parsed.push(path);

            const module = new Module(path);
            for (const i of module.statements.filter(s =>
                s instanceof ModuleImport || s instanceof BoundImport
            )) {
                let path;

                if (i.from.startsWith('./')) {
                    path = `${dirname(module.where.path)}${i.from.substring(1)}`;
                    
                    if (!path.endsWith('.jwl') && !existsSync(path)) {
                        path = `${path}.jwl`;
                    }

                    if (!existsSync(path)) {
                        i.where.error(`no such file ${path}`);
                    }
                } else {
                    i.where.error(`unimpl`);
                }

                i.from = path;
                parseModule(path);
            }
            this.modules.push(module);
        };

        parseModule(path);
    }
}

export class Tagmeme {
    /** @type {Where} */ where;
}

export class Scope extends Tagmeme {
    statements = [];
    /** @type {FunctionDeclaration[]} */ functions = [];
    /** @type {TypeDeclaration[]} */ types = [];

    /**
     * @param {Tokens} tokens 
     * @param {boolean} module 
     */
    constructor(tokens, module = false) {
        super();
        this.where = tokens.where();

        if (module) {
            this.exports = [];
        }

        let importing = module;
        
        if (!module) tokens.expect('{');
        while (module ? tokens.remain() : tokens.value() !== '}') {
            if (tokens.value() === ';') {
                tokens.advance();
                continue;
            }
            
            if (tokens.value() === 'import') {
                if (!importing) tokens.error(
                    `import statements may only appear as the first statements ` +
                    `of a module`
                );

                tokens.advance();
                if (tokens.value() === '*') {
                    this.statements.push(new ModuleImport(tokens));
                } else {
                    /** @type {BoundImport[]} */
                    const imports = [];
                    tokens.expect('{');
                    while (tokens.value() !== '}') {
                        imports.push(new BoundImport(tokens));
                        if (tokens.value() !== '}') tokens.expect(',');
                    }
                    tokens.expect('}');
                    const from = tokens.expect('from', Token.String, ';')[1].value;
                    this.statements.push(...imports.map(i => {
                        i.from = from;
                        return i;
                    }));
                }
                continue;
            }
            
            importing = false;

            const exported = tokens.value() === 'export' ? (tokens.advance(), true) : false;

            if (exported && !module) {
                tokens.error(`exports may only be declared at the module scope`);
            }

            if (tokens.value() === 'function') {
                const fn = new FunctionDeclaration(tokens);
                if (exported) this.exports.push(fn);
                this.functions.push(fn);
            } else if (tokens.value() === 'type' && tokens.peek() instanceof Token.Word) {
                const type = new TypeDeclaration(tokens);
                if (exported) this.exports.push(type);
                this.types.push(type);
            } else {
                if (exported) {
                    tokens.error(`invalid object for export`);
                }

                if (tokens.value() === 'return') {
                    this.statements.push(new Return(tokens));
                } else if (tokens.value() === 'if') {
                    this.statements.push(new Condition(tokens));
                } else if (['let', 'const'].includes(tokens.value()) && tokens.peek() instanceof Token.Word) {
                    this.statements.push(new LocalDeclaration(tokens));
                } else {
                    this.statements.push(new Expression(tokens));
                }
            }
        }
        if (!module) tokens.expect('}');
    }
}

export class Module extends Scope {
    /** @param {string} path  */
    constructor(path) {
        super(new Tokens(path), true);
    }
}

export class ModuleImport extends Tagmeme {
    /** @param {Tokens} tokens  */
    constructor(tokens) {
        super();
        this.where = tokens.where();
        this.binding = tokens.expect('*', 'as', Token.Word)[2].value;
        this.from = tokens.expect('from', Token.String, ';')[1].value;
    }
}

export class BoundImport extends Tagmeme {
    /** @type {string} */ from;

    /** @param {Tokens} tokens  */
    constructor(tokens) {
        super();
        this.where = tokens.where();
        this.name = tokens.expect(Token.Word).value;
        this.binding = tokens.value() === 'as' ? tokens.expect('as', Token.Word)[1].value :
            this.name;
    }
}

export class TypeDeclaration extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens) {
        super();
        this.where = tokens.expect('type').where;
        this.binding = tokens.expect(Token.Word, '=')[0].value;
        this.type = [parseType(tokens), tokens.expect(';')][0];
    }
}

export class LocalDeclaration extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens) {
        super();
        this.constant = tokens.value() === 'const'
            ? (tokens.advance(), true)
            : (tokens.expect('let'), false);
        this.where = tokens.where();
        this.binding = tokens.expect(Token.Word).value;
        this.value = [tokens.expect('='), parseExpression(tokens), tokens.expect(';')][1];
    }
}

export class FunctionDeclaration extends Scope {
    /** @param {Tokens} tokens  */
    constructor(tokens) {
        const where = tokens.where();
        const binding = tokens.expect('function', Token.Word, '(')[1].value;
        const parameters = (() => {
            /** @type {Parameter[]} */ const result = [];
            while (tokens.value() != ')') {
                result.push(new Parameter(tokens));
                if (tokens.value() != ')') tokens.expect(',');
            }
            tokens.expect(')');
            return result;
        })();

        let type;
        if (tokens.value() === ':') {
            tokens.expect(':');
            type = parseType(tokens);
        }

        super(tokens, false);
        this.where = where;
        this.binding = binding;
        this.parameters = parameters;
        this.type = type;
    }
}

export class Parameter extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens) {
        super();
        this.where = tokens.where();
        this.binding = tokens.expect(Token.Word, ':')[0].value;
        this.type = parseType(tokens);
    }
}

export class Typename extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens) {
        super();
        this.where = tokens.where();
        this.binding = tokens.expect(Token.Word).value;
    }
}

export class PointerType extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens) {
        super();
        this.where = tokens.expect('ptr', '[')[0].where;
        this.pointee = parseType(tokens);
        tokens.expect(']');
    }
}

export class ObjectType extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens) {
        super();
        this.where = tokens.expect('{').where;
        this.members = {};
        /** @type {('public' | 'private' | 'readonly')[]} */
        this.visibilities = [];
        while (tokens.value() != '}') {
            if (['public', 'private', 'readonly'].includes(tokens.value()))
                this.visibilities.push(tokens.advance().value);
            else
                this.visibilities.push('public');

            if (tokens.value() in this.members)
                tokens.error(`duplicate property name '${tokens.value()}'`);
            this.members[tokens.expect(Token.Word, ':')[0].value] = parseType(tokens);
            if (tokens.value() != '}') tokens.expect(',');
        }
        tokens.expect('}');
    }
}

export class TupleType extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens) {
        super();
        this.where = tokens.expect('[').where;
        /** @type {any[]} */
        this.members = [];
        while (tokens.value() != ']') {
            this.members.push(parseType(tokens));
            if (tokens.value() != ']') tokens.expect(',');
        }
        tokens.expect(']');
    }
}

export class Return extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens) {
        super();
        this.where = tokens.expect('return').where;
        this.value = parseExpression(tokens);
        tokens.expect(';');
    }
}

export class Condition extends Scope {
    /** @param {Tokens} tokens */
    constructor(tokens, alternative = false) {
        let where, condition;
        if (!alternative || tokens.value() === 'if') {
            where = tokens.expect('if', '(')[0].where;
            condition = [parseExpression(tokens), tokens.expect(')')][0];
        }
        super(tokens, false);
        this.where = where;
        this.condition = condition;
        this.alternatives = [];
        if (!alternative) {
            while (tokens.value() === 'else') {
                const alt = new Alternative(tokens);
                this.alternatives.push(alt);
                if (!alt.condition) break;
            }
        }
    }
}

export class Alternative extends Condition {
    /** @param {Tokens} tokens */
    constructor(tokens) {
        const where = tokens.expect('else').where;
        super(tokens, true);
        this.where = where;
    }
}

export class Expression extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens) {
        super();
        this.where = tokens.where();
        this.value = parseExpression(tokens);
        tokens.expect(';');
    }
}

export class Equality extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens, lhs) {
        super();
        this.lhs = lhs;
        this.where = lhs.where;
        tokens.expect('==');
        this.rhs = parseRelationExpression(tokens);
    }
}

export class Less extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens, lhs) {
        super();
        this.lhs = lhs;
        this.where = lhs.where;
        tokens.expect('<');
        this.rhs = parseSumExpression(tokens);
    }
}

export class Lequal extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens, lhs) {
        super();
        this.lhs = lhs;
        this.where = lhs.where;
        tokens.expect('<=');
        this.rhs = parseSumExpression(tokens);
    }
}

export class Sum extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens, lhs) {
        super();
        this.lhs = lhs;
        this.where = lhs.where;
        tokens.expect('+');
        this.rhs = parseProductExpression(tokens);
    }
}

export class Difference extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens, lhs) {
        super();
        this.lhs = lhs;
        this.where = lhs.where;
        tokens.expect('-');
        this.rhs = parseProductExpression(tokens);
    }
}

export class Product extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens, lhs) {
        super();
        this.lhs = lhs;
        this.where = lhs.where;
        tokens.expect('*');
        this.rhs = parsePostfixExpression(tokens);
    }
}

export class Quotient extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens, lhs) {
        super();
        this.lhs = lhs;
        this.where = lhs.where;
        tokens.expect('/');
        this.rhs = parsePostfixExpression(tokens);
    }
}

export class Cast extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens, lhs) {
        super();
        this.lhs = lhs;
        this.where = lhs.where;
        tokens.expect('as');
        this.rhs = parseType(tokens);
    }
}

export class Access extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens, lhs) {
        super();
        this.lhs = lhs;
        this.where = lhs.where;
        tokens.expect('.');
        this.rhs = new Binding(tokens);
    }
}

export class Index extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens, lhs) {
        super();
        this.lhs = lhs;
        this.where = lhs.where;
        tokens.expect('[');
        this.rhs = new Integer(tokens);
        tokens.expect(']');
    }
}

export class Call extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens, lhs) {
        super();
        this.lhs = lhs;
        this.where = lhs.where;
        tokens.expect('(');
        this.arguments = [];
        while (tokens.value() != ')') {
            this.arguments.push(parseExpression(tokens));
            if (tokens.value() != ')') tokens.expect(',');
        }
        tokens.expect(')');
    }
}

export class Binding extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens) {
        super();
        this.where = tokens.where();
        this.value = tokens.expect(Token.Word).value;
    }
}

export class Integer extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens) {
        super();
        this.where = tokens.where();
        this.value = parseInt(tokens.expect(Token.Integer).value);
    }
}

export class Scalar extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens) {
        super();
        this.where = tokens.where();
        this.value = parseFloat(tokens.expect(Token.Scalar).value);
    }
}

export class ObjectLiteral extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens) {
        super();
        this.where = tokens.where();
        this.members = {};
        tokens.expect('{');
        while (tokens.value() != '}') {
            if (tokens.peek().value !== ':') {
                const binding = new Binding(tokens);
                if (binding.value in this.members)
                    binding.where.error(`duplicate property name '${binding.value}'`);
                this.members[binding.value] = binding;
            } else {
                const binding = new Binding(tokens);
                if (binding.value in this.members)
                    binding.where.error(`duplicate property name '${binding.value}'`);
                tokens.expect(':');
                this.members[binding.value] = parseExpression(tokens);
            }
            if (tokens.value() !== '}') tokens.expect(',');
        }
        tokens.expect('}');
    }
}

export class Tuple extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens) {
        super();
        this.where = tokens.where();
        /** @type {Tagmeme[]} */
        this.values = [];
        tokens.expect('[');
        while (tokens.value() != ']') {
            this.values.push(parseExpression(tokens));
            if (tokens.value() != ']') tokens.expect(',');
        }
        tokens.expect(']');
    }
}

export class Syscall extends Tagmeme {
    /** @param {Tokens} tokens */
    constructor(tokens) {
        super();
        this.where = tokens.where();
        tokens.expect('syscall', '(');
        /** @type {Tagmeme[]} */
        this.arguments = [];
        while (tokens.value() != ')') {
            this.arguments.push(parseExpression(tokens));
            if (tokens.value() != ')') tokens.expect(',');
        }
        tokens.expect(')');
    }
}

/** @param {Tokens} tokens */
function parseType(tokens) {
    if (tokens.value() == 'ptr') return new PointerType(tokens);
    if (tokens.value() == '{') return new ObjectType(tokens);
    if (tokens.value() == '[') return new TupleType(tokens);
    return new Typename(tokens);
}

/** @param {Tokens} tokens */
function parseExpression(tokens) {
    return parseEqualityExpression(tokens);
}

/** @param {Tokens} tokens */
function parseEqualityExpression(tokens) {
    let lhs = parseRelationExpression(tokens);
    while (true) switch (tokens.value()) {
        case '==': lhs = new Equality(tokens, lhs); break;
        default: return lhs;
    }    
}

/** @param {Tokens} tokens */
function parseRelationExpression(tokens) {
    let lhs = parseSumExpression(tokens);
    while (true) switch (tokens.value()) {
        case '<': lhs = new Less(tokens, lhs); break;
        case '<=': lhs = new Lequal(tokens, lhs); break;
        default: return lhs;
    }
}

/** @param {Tokens} tokens */
function parseSumExpression(tokens) {
    let lhs = parseProductExpression(tokens);
    while (true) switch (tokens.value()) {
        case '+': lhs = new Sum(tokens, lhs); break;
        case '-': lhs = new Difference(tokens, lhs); break;
        default: return lhs;
    }
}

/** @param {Tokens} tokens */
function parseProductExpression(tokens) {
    let lhs = parsePostfixExpression(tokens);
    while (true) switch (tokens.value()) {
        case '*': lhs = new Product(tokens, lhs); break;
        case '/': lhs = new Quotient(tokens, lhs); break;
        default: return lhs;
    }
}

/** @param {Tokens} tokens */
function parsePostfixExpression(tokens) {
    let lhs = parsePrimaryExpression(tokens);
    while (true) switch (tokens.value()) {
        case 'as': lhs = new Cast(tokens, lhs); break;
        case '.': lhs = new Access(tokens, lhs); break;
        case '[': lhs = new Index(tokens, lhs); break;
        case '(': lhs = new Call(tokens, lhs); break;
        default: return lhs;
    }
}

/** @param {Tokens} tokens */
function parsePrimaryExpression(tokens) {
    if (tokens.now() instanceof Token.Integer) return new Integer(tokens);
    if (tokens.now() instanceof Token.Scalar) return new Scalar(tokens);
    if (tokens.now() instanceof Token.Word) return new Binding(tokens);
    if (tokens.value() === '{') return new ObjectLiteral(tokens);
    if (tokens.value() === '[') return new Tuple(tokens);
    if (tokens.value() === 'syscall') return new Syscall(tokens);
    if (tokens.value() === '(') return [tokens.expect('('), parseExpression(tokens), tokens.expect(')')][1];
    tokens.error(`expected an expression`);
}
