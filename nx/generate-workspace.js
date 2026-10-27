
const glob = require("glob");
const fs = require("fs");
const ignore = require('ignore');
var ig = ignore();
if(fs.existsSync('.gitignore')){
    var gitignoreContents = fs.readFileSync('.gitignore', 'utf-8');
    gitignoreContents.split(/\r?\n/).forEach(line => {
        ig.add(line);
    })
}
const PHPUNIT = '${DEN} env exec -T php-fpm ./vendor/bin/phpunit -c dev/tests/unit/phpunit.xml';

var workspaceJson = {
    version: 2,
    projects: {}
};

console.log('Generating workspace.json');

let paths = glob.sync('**/composer.json');
paths = ig.filter(paths);
paths.forEach(path => {
    var composerJson = JSON.parse(fs.readFileSync(path));
    if(composerJson.name){
        // Collect every Test/Unit directory in the package at any depth.
        // Components keep their tests in <Package>/<Component>/Test/Unit
        // (e.g. Framework/Interception/Test/Unit), so glob for all of them.
        // Mirrors dev/tests/unit/phpunit.xml.dist, which includes both
        // lib/internal/*/*/Test/Unit and lib/internal/*/*/*/Test/Unit.
        let packageRoot = path.replace('composer.json', '');
        let unitTestDirectories = glob.sync(packageRoot + '**/Test/Unit');
        let unitTestCommand = unitTestDirectories.length? PHPUNIT + ' ' + unitTestDirectories.join(' ') : 'echo "no unit tests"';
        // Works around php/php-src#24488: in PHP 8.4.27 and 8.5.12 the cycle
        // collector double-frees a SimpleXMLElement's properties table, so the run
        // aborts with "zend_mm_heap corrupted" and prints no test summary. Here it
        // fires when View/Test/Unit/Layout/Reader/UiComponentTest shares a process
        // with View/Test/Unit/LayoutTest; either file alone is fine, and PHP 8.3.x
        // and <= 8.4.26 are unaffected. Corruption cannot cross a process boundary,
        // so run that one file in a phpunit process of its own. Both commands
        // always run and their exit codes are combined, so failures in the main run
        // cannot hide the split file's result.
        // Fixed upstream by php-src f9634847258a; revert once CI runs PHP 8.4.28.
        let heapBugFile = packageRoot + 'View/Test/Unit/Layout/Reader/UiComponentTest.php';
        if (unitTestDirectories.length && fs.existsSync(heapBugFile)) {
            unitTestCommand = PHPUNIT + " --exclude-filter '/Reader.UiComponentTest/' " + unitTestDirectories.join(' ')
                + '; rc_main=$?; ' + PHPUNIT + ' ' + heapBugFile
                + '; rc_split=$?; exit $((rc_main|rc_split))';
        }
        workspaceJson.projects[composerJson.name] = {
            root: path.replace('composer.json', ''),
            sourceRoot: path.replace('/composer.json', ''),
            projectType: composerJson.type? composerJson.type : 'unknown', 
            targets: {
                'test:unit': {
                    command: unitTestCommand

                },
                'test:integration': {
                    command: 'echo "integration tests for: '+composerJson.name+'"'
                },
                'test:test': {
                    command: unitTestCommand
                }
            },
            tags: [],
            implicitDependencies: [],
        };
    }
})

console.log('writing to workspace.json');
fs.writeFileSync('workspace.json', JSON.stringify(workspaceJson, null, 2));

process.exit();

const magentoDirectory = process.cwd()+'/magento2';
console.log('Generate workspace.json', {
    magentoDirectory
});

if(!fs.existsSync(magentoDirectory)){
    console.log('No magento directory found, please clone magento into "magento2" directory and try again.');
    process.exit(1);
}

var composerJsons = [
    ...glob.sync(magentoDirectory + '/app/code/*/*/composer.json'),
    ...glob.sync(magentoDirectory + '/lib/internal/Magento/*/*/composer.json'),
    magentoDirectory + '/lib/internal/Magento/Framework/composer.json',
];

console.log('Found '+composerJsons.length+' composer.json\'s');

for(var i=0; i<composerJsons.length; i++){
    let composerJsonPath = composerJsons[i];
    let package = JSON.parse(fs.readFileSync(composerJsonPath).toString());
    console.log('processing package: %s (path: %s)', package.name, composerJsonPath);

    let autoloadKeys = Object.keys(package.autoload['psr-4']);
    if(autoloadKeys.length == 0){
        console.log('package doesnt have autoload configured', {
            package,
            autoload: package.autoload
        });
        process.exit(2);
    }else if(autoloadKeys.length > 1){
        console.log('package has more then one autoload configured', {
            package,
            autoload: package.autoload
        });
        process.exit(3);
    }else if(package.autoload['psr-4'][autoloadKeys[0]] != ''){
        console.log('not a simple autoload', {
            package,
            autoload: package.autoload
        });
        process.exit(4);
    }
    let moduleDirectory = autoloadKeys[0].replaceAll('\\', '/');
    // remove trailing slash
    if(moduleDirectory.slice(-1) == '/'){
        moduleDirectory = moduleDirectory.slice(0, -1);
    }

    let path = composerJsonPath.replace(process.cwd()+'/', '').split('/').slice(0, -1).join('/');
    workspaceJson.projects[package.name] = {
        root: path+'/',
        sourceRoot: path,
        projectType: 'library',
        targets: {
            build: {
                executor: '@nrwl/workspace:run-commands',
                // "inputs": [
                //     "{projectRoot}/**/*",
                //     "{projectRoot}**/*",
                //     "{projectRoot}/**",
                //     "{projectRoot}**"
                //   ],
                options: {
                    commands: [
                        {
                            command: 'mkdir -p vendor/' + package.name + ' && rsync magento2/app/code/' + moduleDirectory + ' vendor/' + package.name + ' --exclude Test -r'
                        }
                    ]
                }
            }
        },
        implicitDependencies: [
            'php-executor'
        ]
    };
}

console.log('writing to workspace.json');
fs.writeFileSync('workspace.json', JSON.stringify(workspaceJson, null, 2));