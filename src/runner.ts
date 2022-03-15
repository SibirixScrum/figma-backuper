const Backuper = require('./backuper');

const flags = process.argv.slice(2);

const backuper = new Backuper({
    verbose: flags.indexOf('--verbose') !== -1,
    debug: flags.indexOf('--debug') !== -1,
    all: flags.indexOf('--all') !== -1,
    autoIncremental: flags.indexOf('--auto-incremental') !== -1,
});

backuper.doBackup();
