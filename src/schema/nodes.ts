import redent from 'redent';

export abstract class Node {
  protected children: Node[];

  constructor() {
    this.children = [];
  }

  addChild<T extends Node>(child: T): T {
    this.children.push(child);
    return child;
  }

  addChildren<T extends Node>(children: T[]) {
    this.children = this.children.concat(children);
  }

  abstract serialize(): string;
}

export class Root extends Node {
  private interfaceNames = new Set<string>();
  private main?: MainClass;

  addChild<T extends Node>(child: T): T {
    if (child instanceof Interface) {
      if (this.interfaceNames.has(child.name)) {
        throw new Error(`Interface already exists: ${child.name}`);
      }
      this.interfaceNames.add(child.name);
    }
    return super.addChild(child);
  }

  addInterface(name: string): Interface {
    return this.addChild(new Interface(name));
  }

  addMain(name?: string, base?: string): MainClass {
    if (this.main) {
      throw new Error('Main class already defined');
    }
    const main = this.addChild(new MainClass(name, base));
    this.main = main;
    return main;
  }

  getMain(): MainClass {
    if (!this.main) {
      throw new Error('No main class defined');
    }
    return this.main;
  }

  serialize(): string {
    const lines = [];
    for (const child of this.children) {
      lines.push(child.serialize());
    }
    return lines.join('\n\n');
  }
}

export class ImportStatement extends Node {
  private importName = 'XAPI';

  constructor(readonly moduleName: string = 'jsxapi') {
    super();
  }

  serialize(): string {
    return `import { ${this.importName}, connectGen } from "${this.moduleName}";`;
  }
}

function renderTree(nodes: Node[], terminator: string) {
  const serialized = nodes.map((n) => `${n.serialize()}${terminator}`);
  if (serialized.length) {
    serialized.unshift('');
    serialized.push('');
  }
  return redent(serialized.join('\n'), 2);
}

type Valuespace = Type | string;

export interface Type {
  getType(): string;
}

export class Plain implements Type {
  constructor(readonly text: string) {}

  getType() {
    return this.text;
  }
}

export class Function extends Node implements Type {
  constructor(
    readonly name: string,
    readonly args: [string, Type][] = [],
    readonly ret: Type = new Plain('void'),
  ) {
    super();
  }

  getType(separator: string = ' =>') {
    const args = this.args.map(([n, t]) => `${n}: ${t.getType()}`).join(', ');
    const ret = this.ret.getType();
    return `(${args})${separator} ${ret}`;
  }

  serialize() {
    return `${this.name}${this.getType(':')}`;
  }
}

export class List implements Type {
  constructor(readonly elementType: Type) {}

  getType() {
    const elemType = this.elementType.getType();
    const withParens =
      this.elementType instanceof Literal ? `(${elemType})` : elemType;
    return `${withParens}[]`;
  }
}

export class Literal implements Type {
  private members: Type[];

  constructor(...members: Valuespace[]) {
    this.members = members.map((m) => {
      if (typeof m === 'string') {
        return new Plain(`'${m}'`);
      }
      return m;
    });
  }

  getType() {
    return this.members.map((m) => m.getType()).join(' | ');
  }
}

class Interface extends Node implements Type {
  constructor(readonly name: string) {
    super();
  }

  getType(): string {
    return this.name;
  }

  serialize(): string {
    const tree = renderTree(this.children, ';');
    return `export interface ${this.name} {${tree}}`;
  }
}

class MainClass extends Interface {
  constructor(name: string = 'TypedXAPI', readonly base: string = 'XAPI') {
    super(name);
  }

  serialize(): string {
    return `\
export class ${this.name} extends ${this.base} {}

export default ${this.name};
export const connect = connectGen(${this.name});

${super.serialize()} `;
  }
}

export class Member extends Node {
  private type: Type;

  constructor(
    readonly name: string,
    type: Valuespace,
    readonly options?: { required: boolean },
  ) {
    super();
    this.type = typeof type === 'string' ? new Plain(type) : type;
  }

  serialize(): string {
    const optional = !this.options || this.options.required ? '' : '?';
    const name = this.name.match(/^[a-z][a-z0-9]*$/i)
      ? this.name
      : `"${this.name}"`;
    return `${name}${optional}: ${this.type.getType()}`;
  }
}

export class Tree extends Node {
  constructor(readonly name: string) {
    super();
  }

  serialize(): string {
    const tree = renderTree(this.children, ',');
    return `${this.name}: {${tree}}`;
  }
}

export class Command extends Node {
  private params?: Type;
  private retval?: Type;

  constructor(readonly name: string, params?: Valuespace, retval?: Valuespace) {
    super();
    if (params) {
      this.params = typeof params === 'string' ? new Plain(params) : params;
    }
    if (retval) {
      this.retval = typeof retval === 'string' ? new Plain(retval) : retval;
    }
  }

  serialize(): string {
    const args = this.params ? `args: ${this.params.getType()}` : '';
    const retval = this.retval ? this.retval.getType() : 'any';
    return `${this.name}(${args}): Promise<${retval}>`;
  }
}

export class Config extends Tree {
  constructor(name: string, readonly valuespace: Valuespace) {
    super(name);
    const vstype = typeof valuespace === 'string' ? new Plain(valuespace) : valuespace;
    this.addChild(new Command('get', undefined, vstype));
    this.addChild(new Command('set', vstype));
    const handler = new Function('handler', [['value', vstype]]);
    this.addChild(new Function('on', [['handler', handler]]));
    this.addChild(new Function('once', [['handler', handler]]));
  }
}

export class Status extends Tree {
  constructor(name: string, readonly valuespace: Valuespace) {
    super(name);
    const vstype = typeof valuespace === 'string' ? new Plain(valuespace) : valuespace;
    this.addChild(new Command('get', undefined, vstype));
    const handler = new Function('handler', [['value', vstype]]);
    this.addChild(new Function('on', [['handler', handler]]));
    this.addChild(new Function('once', [['handler', handler]]));
  }
}
