import { readFileSync as open } from 'fs';

const SYMBOLS = [
    '(', ')', '{', '}', '[', ']', '<', '>',
    '+', '-', '*', '/', ',', ';', ':', '.',
    '=',
];

const POLYGRAPHS = [
    '==', '!=', '+=', '-=', '*=', '/=',
    '<=', '>=',
];

const KEYWORDS = [
    'import', 'export', 'function', 'object', 'as',
    'syscall', 'ptr', 'if', 'for', 'while', 'else',
    'type', 'let', 'const',
];

/** @extends {Array<Token>} */
export class Tokens extends Array {
    cursor = 0;

    /** @param {string} path  */
    constructor(path) {
        /** @type {Token[]} */
        let tokens = [];
        const back = () => tokens[tokens.length - 1];

        let where = new Where(path, 1, 0);
        for (const char of open(path, {encoding: 'utf8'})) {
            where = new Where(path, where.row, where.col + 1);
            
            if (back() instanceof BlockComment) {
                back().value += char;
                if (back().value.endsWith('*/')) tokens.pop();
            } else if (back() instanceof LineComment) {
                back().value += char;
                if (char === '\n') tokens.pop();
            } else if (back() instanceof String) {
                back().value += char;
                const value = back().value;
                if (value.endsWith(value[0])) {
                    back().value = value.substring(1, value.length - 1);
                    tokens.push(null);
                }
            } else if (["'", '"'].includes(char)) {
                tokens.push(new String(where, char));
            } else if (char === '#') {
                tokens.push(new LineComment(where, char));
            } else if (char == '/' && back() && back().value == '/') {
                const t = tokens.pop();
                tokens.push(new LineComment(t.where, t.value + char));
            } else if (char == '*' && back() && back().value == '/') {
                const t = tokens.pop();
                tokens.push(new BlockComment(t.where, t.value + char));
            } else if (/\s/.test(char)) {
                tokens.push(null);
            } else if (/[a-zA-Z]/.test(char)) {
                if (back() instanceof Word) back().value += char;
                else tokens.push(new Word(where, char));
            } else if (/[0-9]/.test(char)) {
                if (
                    back() instanceof Word ||
                    back() instanceof Integer ||
                    back() instanceof Scalar
                ) back().value += char;
                else tokens.push(new Integer(where, char));
            } else if (char === '.' && back() instanceof Integer) {
                const t = back();
                tokens.pop();
                tokens.push(new Scalar(t.where, t.value + char));
            } else if (SYMBOLS.includes(char)) {
                if (back() instanceof Symbol && POLYGRAPHS.includes(back().value + char))
                    back().value += char;
                else
                    tokens.push(new Symbol(where, char));
            } else {
                where.error(`failed to tokenize character '${char}'`);
            }

            if (char === '\n') where = new Where(path, where.row + 1, 0);
        }

        super(...tokens
            .filter(t => t !== null)
            .map(t => {
                if (t instanceof Word && KEYWORDS.includes(t.value))
                    return new Keyword(t.where, t.value);
                return t;
            }), new EOF(where, 'end of file')
        );
    }

    now() {
        return this[this.cursor];
    }

    where() {
        return this.now().where;
    }

    value() {
        return this.now().value;
    }

    advance() {
        return this[this.cursor++];
    }

    remain() {
        return !(this.now() instanceof EOF);
    }

    peek(offset = 1) {
        return this[this.cursor + offset];
    }

    /**
     * @overload
     * @param {string | typeof Token} first
     * @returns {Token}
     * 
     * @overload
     * @param {string | typeof Token} first 
     * @param {...(string | typeof Token)} expected 
     * @returns {Token[]}
     */
    expect(first, ...rest) {
        /** @type {Token[]} */ const r = [];
        for (const e of [first, ...rest]) {
            if (typeof e === 'string' && this.value() != e)
                this.error(`expected '${e}' but found '${this.value()}'`)
            else if (typeof e !== 'string' && !(this.now() instanceof e))
                this.error(`expected ${e.name} but found ${
                    this.now().constructor.name} '${this.value()}'`);
            r.push(this.advance());
        }
        return r.length == 1 ? r[0] : r;
    }

    /**
     * @param {string} what 
     * @returns {never}
     */
    error(what) {
        this.where().error(what);
    }

    if(expected, yes, no) {
        if (typeof expected === 'string' && this.value() === expected) {
            this.advance();
            return yes;
        }
        if (typeof expected !== 'string' && this.now() instanceof expected) {
            this.advance();
            return yes;
        }
        return no;
    }
}

export class Token {
    /**
     * @param {Where} where 
     * @param {string} value 
     */
    constructor(where, value) {
        this.where = where;
        this.value = value;
    }
}

export class EOF extends Token {}
export class Word extends Token {}
export class String extends Token {}
export class Symbol extends Token {}
export class Scalar extends Token {}
export class Keyword extends Token {}
export class Integer extends Token {}
class LineComment extends Token {}
class BlockComment extends Token {}

export class Where {
    /**
     * @param {string} path 
     * @param {number} row 
     * @param {number} col 
     */
    constructor(path, row, col) {
        this.path = path;
        this.row = row;
        this.col = col;
    }

    /**
     * @param {string} what 
     * @returns {never}
     */
    error(what) {
        throw new WhereError(this, what);
    }

    toString() {
        return `${this.path}:${this.row}:${this.col}`;
    }
}

export class WhereError extends Error {
    /**
     * @param {Where} where 
     * @param {string} what 
     */
    constructor(where, what) {
        super(`${where}: ${what}`);
    }
}
