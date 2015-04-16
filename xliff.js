/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
 
define(function(require, exports, module) {

var baseLanguageHandler = require('plugins/c9.ide.language/base_handler');
var tree = require("treehugger/tree");
var traverse = require("treehugger/traverse");
// make sure to add .js if ?noworker is specified
var sax = require('./sax-js/lib/sax');

var xliff = module.exports = Object.create(baseLanguageHandler);

xliff.handlesLanguage = function(language) {
    return language === "xml" && /\.xliff$/.test(this.path);
};

xliff.parse = function(value, callback) {
    var stack = [[]];
    var depth = 0;
    var parser = sax.parser(true);
    var parserpos = {sl: 0, sc: 0};
    var wantText = false;
    function bumpPos() {
        var _pos = parserpos;
        parserpos = {sl: parser.line, sc: parser.column};
        return _pos;
    }
    function posify(node) {
        node.setAnnotation('pos', bumpPos());
    }
    parser.onerror = function(er) {
        var tip = stack[depth];
        if (tip[0] && tip[tip.length - 1].cons !== 'Error') {
            var node = tree.cons('Error', [
                tree.string(er.message)
            ]);
            posify(node);
            stack[depth].push(node);
        }
        // let's silence the parser error now that we have it in the AST
        parser.error = null;
    };
    parser.ontext = function(text) {
        // just placeholder to make sure we update positions
        if (wantText) {
            var node = tree.string(text);
            posify(node);
            stack[depth].push(node);
        }
        else {
            bumpPos();
        }
    };
    parser.onattribute = function(attr) {
        // might be interesting if we had source start data
    };
    parser.onopentag = function(node) {
        var namenode = tree.cons('Name',[
            tree.string(node.name)
        ]);
        posify(namenode);
        stack.push([namenode]); ++depth;
        wantText = node.name === 'source' || node.name === 'target';
        var attrs = [];
        for (var attrname in node.attributes) {
            attrs.push(tree.cons('Attr',
                [tree.string(attrname),
                 tree.string(node.attributes[attrname])]));
        }
        stack[depth].push(tree.cons('Attributes', attrs));
    };
    parser.onclosetag = function(name) {
        var children = stack.pop(); --depth;
        wantText = false;
        var node = tree.cons('Element', children);
        var openPos = children[0].getPos();
        node.setAnnotation('pos', {
            sl: openPos.sl,
            sc: openPos.sc,
            el: parser.line,
            ec: parser.column
        });
        bumpPos();
        stack[depth].push(node);
    };
    parser.onend = function() {
        var doc = tree.cons('Document', stack[0]);
        traverse.addParentPointers(doc);
        callback(doc);
    };
    parser.write(value).close();
};

function getElements(root, name) {
    var pattern = 'Name("' + name + '")';
    return root.collectTopDown(function() {
        if (this instanceof tree.ConsNode && this.cons == "Element") {
            // see if we're a wanted elment, first child is our Name
            if (this[0].isMatch(pattern)) {
                return this;
            }
        }
    });
}

xliff.outline = function(doc, fullAst, callback) {
    var items = [];
    var files = getElements(fullAst, 'file');
    files.forEach(function (filenode) {
        var filepath;
        filenode.collectTopDown(
            'Attr("original", path)',
            function(binding) {
                filepath = binding.path.value;
            }
        );
        var trans_units = getElements(filenode, 'trans-unit');
        var unit_items = [];
        trans_units.forEach(
            function(unit) {
                var id;
                unit.collectTopDown(
                    'Attr("id", id)',
                    function(binding) {
                        id = binding.id.value;
                    }
                );
                unit_items.push({
                    icon: "method",
                    name: id,
                    pos: {sl: unit.getPos().sl}
                });
            }
        );
        items.push({
            icon: "package",
            name: filepath,
            items: unit_items,
            pos: {sl: filenode.getPos().sl}
        });
    });
    callback({items: items});
};

xliff.analyze = function(value, fullAst, callback, minimalAnalysis) {
    // Analysis reports missing target-language on files,
    // and trans-units without target
    // oh, and xml parsing errors, of course
    var items = [];
    var files = getElements(fullAst, 'file');
    files.forEach(function (filenode) {
        if (filenode.collectTopDown('Attr("target-language",_)').length === 0) {
            items.push({
                pos: filenode.getPos(),
                type: "error",
                message: "<file> needs target-language attribute"
            });
        }
        var trans_units = getElements(filenode, 'trans-unit');
        trans_units.forEach(
            function(unit) {
                if (getElements(unit, 'target').length !== 1) {
                    items.push({
                        pos: unit.getPos(),
                        type: "error",
                        message: "<trans-unit> needs one target element"
                    });
                }
            }
        );
    });
    fullAst.collectTopDown(
        'Error(message)',
        function(bindings, node) {
            items.push({
                pos: node.getPos(),
                type: "error",
                message: bindings.message.value
            });
        });
    callback(items);
};

var TMCache = {};
xliff.complete = function(doc, fullAst, pos, currentNode, callback) {
    if (!currentNode) {
        var huggerpos = {
            line: pos.row,
            col: pos.column
        };
        currentNode = fullAst.findNode(huggerpos);
    }
    if (!currentNode ||
        !(currentNode.isMatch('Element(Name("target"),_)') ||
          currentNode.isMatch('Element(Name("target"),_,_)'))) {
        callback();
        return;
    }
    var unit = currentNode.parent;
    var file = unit.parent.parent;
    var fileattrs = file[1];
    var targetlang;
    fileattrs.collectTopDown(
        'Attr("target-language",lang)',
        function(bindings, node) {
            targetlang = bindings.lang.value;
        }
    );
    if (!targetlang) {
        callback();
        return;
    }
    if (!TMCache[targetlang]) {
        TMCache[targetlang] = {};
    }
    // find source child of trans-unit
    var source;
    for (var i=2; i < unit.length; ++i) {
        if (unit[i].isMatch('Element(Name("source"), _, _)')) {
            source = unit[i][2].value;
        }
    }
    if (!source) {
        callback();
        return;
    }
    if (source in TMCache[targetlang]) {
        callback(TMCache[targetlang][source]);
        return;
    }
    // ok, I'm sorry, we've actually gotta do an xhr and load the data now
    var xhr = new XMLHttpRequest();
    var apiurl = "https://transvision-proxy.paas.allizom.org/api/v1/tm/aurora/en-US/";
    apiurl += targetlang + "/" + encodeURIComponent(source) + '/';
    apiurl += "?max_results=3&min_quality=80";
    xhr.open("GET", apiurl, true);
    xhr.onload = function() {
        var response = JSON.parse(this.responseText);
        var completions = [];
        for (var i=0, ii=response.length; i < ii; ++i) {
            completions.push({
               name: response[i].target,
               replaceText: response[i].target,
               meta: "TM: " + response[i].quality,
               priority: response[i].quality
            });
        }
        TMCache[targetlang][source] = completions;
        callback(completions);
    };
    xhr.onerror = function() {
        console.log('error connecting to transvision');
        callback();
    };
    xhr.send();
};

});
