const assert = require('assert');
const translates = require('./helper');

describe('AST translation', function() {
    it('Expressions', function() {
        translates("2 + 2");
        translates("$a = null", 'var a = undefined;');
        translates("$a .= 'x'", 'a += "x";');
        translates("$a = NuLL;", 'var a = undefined;');
        translates("$a + 1");
        translates("$a = $b = 1", 'var b; var a = b = 1;');
        translates("$c = $d ? 1 : 2", 'var c = d ? 1 : 2;');
        translates("$d ?: 2", 'd ? d : 2;');
        translates("$a[1] + $b[Z]", "a[1] + b[Z];");
        translates("$b[$foo['Z']]", `b[foo.Z];`);
        translates('"f\\no\\\\o" + "\\"`\\\\d`";');
        translates('"\n\'encapsed\' \\\\ `$back`";', '`\\n\'encapsed\' \\\\ \\`${back}\\``;');
        translates('bar();');
        translates('eval($lol);');
        translates('(int)"1";', '+"1";');
        translates('(float)"1";', '+"1";');
        translates('(bool)"1";', '!!"1";');
        translates('(string)$x;', 'String(x);');
        translates('(object)$x;', 'Object(x);');
        translates('(array)$x;', 'Array.from(x);');
        translates('fun(...[1,2,3]);');
    });

    it('Builtins', function() {
        translates('echo "foo",$bar;', 'echo("foo", bar);');
        translates(' ?>x', 'echo("x");');
        translates('print "foo";', 'print("foo");');
        translates('isset($x[$y]);', 'undefined !== x[y];');
        translates('isset($x[$y], $z);', 'undefined !== x[y] && undefined !== z;');
        translates('empty($x[$y]);', '!x[y];');
        translates('unset($x[$y]);', 'delete x[y];');
        translates('function is_bool(){}; is_bool($x);');
        translates('__FILE__;', '__filename;');
        translates('__DIR__;', '__dirname;');
        translates('function foo(){__FUNCTION__;}', 'function foo(){"foo";};');
        translates('__LINE__;\n__LINE__;', '1;\n2;');
    });

    it('Array and list', function() {
        translates("$a = []; $a['x'] = 2;", 'var a = Array(); a.x = 2;');
        translates("$a = [1,2]; $a = 2;", 'var a = [1,2]; a = 2;');
        translates("$a = ['x' => 1]", 'var a = {x:1};');
        translates("$a = [' ' => 1]", 'var a = {" ":1};');
        translates("$a = [$z => 1]", 'var a = {[z]:1};');
        translates("$a = [$z => 1, 'a', 'b']", 'var a = {[z]:1, 0:"a", 1:"b"};');
        translates("$a = ['a', $z => 1, 'b']", 'var a = {0:"a", [z]:1, 1:"b"};');
        translates("$a = ['a', 3 => 'c', 'b']", 'var a = {0:"a", 3:"c", 4:"b"};');

        translates("list($a, $b) = [1,2]", "var a,b; [a,b] = [1,2];");
        translates("list($a,,$b) = [1,2]", "var a,b; [a,,b] = [1,2];");

        translates("$a[] = 1", 'a.push(1);');
        translates("foo($a['b'][]);", 'foo(a.b);');
        translates("$a[1][] = 1", 'a[1].push(1);');
        translates("$a['b']['c'][]['d']['e'] = 1;", 'a.b.c.push({d:{e:1}});');
        translates("$a[CON] = 1", 'a[CON] = 1;');
        translates("$a->foo[] = 1", 'a.foo.push(1);');
        translates("$a->{$foo}[] = 1", 'a[foo].push(1);');
    });

    it('Templates', function() {
        translates('"foo$bar"', '`foo${bar}`;');
        translates('"foo$bar baz";', '`foo${bar} baz`;');
        translates('"${not_varvar}"', '`${not_varvar}`;');
        translates('"foo${bar}$quz"', '`foo${bar}${quz}`;');
        translates('"foo${2+2}"', '`foo${global[2+2]}`;');

        translates('$$var', 'global[var];');

        translates('"foo${$varvar}"', '`foo${global[varvar]}`;');
    });

    it('Functions', function() {
        translates("function bar($foo) {return $foo + 1;}");
        translates("function bar($foo) {$foo = 2;}");
        translates("function bar(TypeName $foo) {$foo = 2;}", 'function bar(foo: TypeName) {foo = 2;};');
        translates("$a=1; function bar() {$a = 2;}", 'var a=1; function bar() {var a = 2;};');
        translates('$z = function() use($x){$x=1;$y=2;};', 'var z = () => {x=1;var y =2;};');
        translates('$z = function(){static $n;};', 'var z = () => {if (!("_static_closure_0_n" in global)) _static_closure_0_n = undefined;};');
        translates("if ($a = 1) {if ($b = 2 && $c = 2) {}}", 'var a; if (a = 1) {var b,c; if (b = 2 && (c = 2)) {}}');
    });

    it('Loops', function() {
        translates("for($x=1; $x < 10; $x++, $y++){}", 'for(var x=1; x<10; x++, y++){}');
        translates("foreach($arr as $el){}", 'for (var el of Object.values(arr)) {}');
        translates("foreach([1,2,3] as $el){}", 'for (var el of [1,2,3]) {}');
        translates("foreach($arr as $k => $v){}", 'for (var k in arr) {var v = arr[k];}');
        translates("foreach(func() as $k => $v){}", '{let _tmp_0 = func(); for (var k in _tmp_0) {var v = _tmp_0[k];}}');
        translates("while(true) { $a--; break; }");
        translates("do{if(false)continue;}while(true);");
    });

    it('Statements', function() {
        translates('switch($c) {case "a": case "b": return $c; default: return $z;}');
        translates('require "foo";', 'require("foo");');
        translates('include_once "foo";', 'require("foo");');
        translates("if (false) while(true) { $a--; }");
        translates("if (false) if (true) { --$a; }");
        translates("exit(1)", "throw die(1);");
        translates('const FOO = 123;');
        translates('foreach($a as $b => $d) foreach($d as $e => $f) {}', 'for (var b in a) {var d = a[b];for (var e in d) {var f = d[e];}}');
    });

    it('Exceptions', function() {
        translates("try {hey();} catch(Exception $e) {bye($e);}", "try {hey();} catch(e) {bye(e);}");
        translates('try{}catch(\\Exception $e){}', 'try{}catch(e){}');
        translates('throw new Error()');
        translates('try{}catch(Foo $e){$a=1;}', 'try{}catch(e){if (e instanceof Foo) {var a=1;}}');
        translates('function foo(){static $z; try{}catch(Foo $f){$f=1;}catch(Bar $b){$b=1;$z=1;}}', `
        function foo() { if (!("_static_foo_z" in global)) _static_foo_z = undefined;
          try {} catch (f) {
            if (f instanceof Foo) {f = 1;} else if (f instanceof Bar) {
              f = 1;
              _static_foo_z = 1;
            }
          }
        };`);
        translates('try{}catch(Foo | Bar $e){$a=1;}', 'try{}catch(e){if (e instanceof Foo || e instanceof Bar) {var a=1;}}');
        translates('try{}catch(Foo $e){}catch(\\Exception $z){$a=1;}', 'try{}catch(e){if (e instanceof Foo) {} else if (true) {var a=1;}}');
    });

    it('Static', function() {
        translates('function foo() {static $bar; $bar=1;}', 'function foo(){if (!("_static_foo_bar" in global)) _static_foo_bar = undefined;_static_foo_bar=1;};');
        translates('function foo() {global $bar; $bar=1;}', 'function foo(){if (!("bar" in global)) bar = undefined;bar=1;};');
        translates('function foo() {static $bar,$baz=1; $bar=1;}', `function foo(){
            {
                if (!("_static_foo_bar" in global)) _static_foo_bar = undefined;
                if (!("_static_foo_baz" in global)) _static_foo_baz = 1;
            }
            _static_foo_bar=1;};
        `);
    });

    it('Class', function() {
        translates('new Foo($bar)');
        translates('class Foo {}');
        translates('class Foo extends Bar {}');
        translates('class Foo extends Foo\\Bar {}', 'class Foo extends Foo.Bar {};');
        translates('class Foo extends Foo\\Bar\\Baz\\Quz {}', 'class Foo extends Foo.Bar.Baz.Quz {};');
        translates('class Foo extends \\Foo\\Bar {}', 'class Foo extends global.Foo.Bar {};');
        translates('class Foo {function __construct($bla){$this->foo=1;}}', 'class Foo {constructor(bla){this.foo=1;}};');
        translates('class Foo {function __construct($bla){$this->${foo}=1;}}', 'class Foo {constructor(bla){this[foo]=1;}};');
        translates('class Foo {function __construct($bla){parent::foo();}}', 'class Foo {constructor(bla){super.foo();}};');
        translates('class Foo {function __construct($bla){parent::__construct();}}', 'class Foo {constructor(bla){super();}};');
        translates('class Foo {function bar($z){$this->{$meta} = 2;}}', 'class Foo {bar(z){this[meta]=2;}};');
        translates('class Foo {static function bar($z){self::bar();}}', 'class Foo {static bar(z){this.bar();}};');
        translates('class Foo {function bar(){self::CON;}}', 'class Foo {bar(){this.constructor.CON;}};');
        translates('class Foo {private function bar($z=1){} protected function quz(){$this->bar();}}',
            'class Foo {bar(z=1){} quz(){this.bar();}};');
    });

    it('Class props', function() {
        translates('class Foo {const Z=1;}', 'class Foo {static Z=1;};');
        translates('class Foo {static $z=1;}', 'class Foo {static z=1;};');
        translates('class Foo {private static $z=1; static function x(){self::$z;self::${z()};}}',
            'class Foo {static z=1; static x(){this.z;this[z()];}};');
        translates('class Foo {var $z=1;}', 'class Foo {constructor(){this.z=1;}};');
        translates('class Foo extends Bar {var $z=1;}', 'class Foo extends Bar {constructor(){super(...arguments);this.z=1;}};');
        translates('class Foo extends Bar {var $z=1; function __construct(){hi();}}',
            'class Foo extends Bar {constructor(){this.z=1;hi();}};');
        translates('class Foo extends Bar {var $z=1; function __construct(){parent::__construct();hi();}}',
            'class Foo extends Bar {constructor(){super();this.z=1;hi();}};');
    });

    it('Types', function() {
        translates(`class Foo {
        function annotated($untyped, Cls\\Name $class, self $self, array $array, callable $callable, bool $bool, float $float, int $int, string $string, iterable $iter) {}}`,
        `class Foo {
        annotated(untyped, class: Cls.Name, self: Foo, array: {} | any[], callable: Function, bool: boolean, float: number, int: number, string: string, iter: {} | any[]) {}};`);
        translates(`class Foo {
        function annotated($untyped = null, Cls\\Name $class = null, self $self = null, array $array = null,
        callable $callable = null, bool $bool = null, float $float = null, int $int = null, string $string = null, iterable $iter = null) {}}`,
        `class Foo {
        annotated(untyped = undefined, class: ?Cls.Name = undefined, self: ?Foo = undefined, array: ?{} | any[] = undefined,
        callable: ?Function = undefined, bool: ?boolean = undefined, float: ?number = undefined, int: ?number = undefined, string: ?string = undefined, iter: ?{} | any[] = undefined) {}};`);
        translates(`class Foo {
        function annotated($untyped, ?Cls\\Name $class, ?self $self, ?array $array,
        ?callable $callable, ?bool $bool, ?float $float, ?int $int, ?string $string, ?iterable $iter) {}}`,
        `class Foo {
        annotated(untyped, class: ?Cls.Name, self: ?Foo, array: ?{} | any[],
        callable: ?Function, bool: ?boolean, float: ?number, int: ?number, string: ?string, iter: ?{} | any[]) {}};`);
    });
})
