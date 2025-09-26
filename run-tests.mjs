import * as fs from 'fs';
import { execSync } from 'child_process';

const cases = JSON.parse(fs.readFileSync('tst/cases/results.json'));
const fails = [];

for (const path in cases) {
    executeCase(path);
}

console.log();
if (fails.length) {
    console.log(`\x1b[91mThe following test cases failed:`);
    console.log(fails.map(fail => `  ${fail}`).join('\n'));
    console.log('\x1b[0m');
} else {
    console.log(`\x1b[92mAll test cases passed\x1b[0m`);
}

function reportCaseResult(path, status, stdout, stderr) {
    console.log('    status:', `${status}`.padEnd(3), cases[path].status != status
        ? `\x1b[91mFAIL\x1b[0m (${cases[path].status})`
        : '\x1b[92mPASS\x1b[0m'
    );
    console.log(`    stdout: ${stdout}`);
    console.log(`    stderr: ${stderr}`);

    if (status != cases[path].status)
        fails.push(path);
}

function executeCase(path) {
    console.log(`Testing ${path}...`);
    try {
        execSync(`npm start tst/cases/${path} tst/cases/output`);
        try {
            const stdout = execSync(`tst/cases/output`);
            reportCaseResult(path, 0, stdout, '');
        } catch (e) {
            reportCaseResult(path, e.status, e.stdout, e.stderr);
        }
        fs.unlinkSync('tst/cases/output');
    } catch (e) {
        console.log(`  Failed to compile: ${e}`);
    }
}
