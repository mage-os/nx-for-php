
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
        let unitTestDirectory = path.replace('composer.json', '') + 'Test/Unit';
        let unitTestCommand = fs.existsSync(unitTestDirectory)? '${DEN} env exec -T php-fpm ./vendor/bin/phpunit -c dev/tests/unit/phpunit.xml ' + unitTestDirectory : 'echo "no unit tests"';
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