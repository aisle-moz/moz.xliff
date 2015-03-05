/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
 
 define(function(require, exports, module) {
    main.consumes = ["Plugin", "language"];
    main.provides = ["moz.xliff"];
    return main;

    function main(options, imports, register) {
        /***** Hook up language worker *****/
        var language = imports.language;
        var path = options.packagePath;
        path = path.substr(0, path.lastIndexOf("/") + 1);
        path += 'xliff';
        if (false) path += '.js';
        language.registerLanguageHandler(path);

        var Plugin = imports.Plugin;
        
        /***** Initialization *****/
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        var emit = plugin.getEmitter();
        
        function load() {
            console.log('xliff loaded');
        }
        
        /***** Methods *****/
        
        
        
        /***** Lifecycle *****/
        
        plugin.on("load", function() {
            load();
        });
        plugin.on("unload", function() {
        
        });
        
        /***** Register and define API *****/
        
        plugin.freezePublicAPI({
            
        });
        
        register(null, {
            "moz.xliff": plugin
        });
    }
});