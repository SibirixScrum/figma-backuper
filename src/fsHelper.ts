const fs = require('fs');
const glob = require('glob');
const path = require('path');

/**
 *
 */
const createFolder = (pathToCreateFolder: string) => {
    if (!fs.existsSync(pathToCreateFolder)) {
        fs.mkdirSync(pathToCreateFolder, {recursive: true});
    }
};

/**
 *
 */
const prepareFolderName = (...parts) => {
    return path.join(...parts);
};

/**
 * находится ли данный файл в данной директории
 */
const isFileInDirectory = (folderName: string, fileName) => {
    const files = glob.sync(path.join(folderName, `${fileName}.fig`), {nodir: true});

    return files.length > 0;
};

/**
 * перенести файл из временной папки на его реальное место
 */
const moveFile = (tmpFolderName: string, folderName: string, fileName) => {
    const oldPath = path.join(tmpFolderName, `${fileName}.fig`);
    const newPath = path.join(folderName, `${fileName}.fig`);
    fs.renameSync(oldPath, newPath);
    return newPath;
};

module.exports = {
    createFolder,
    prepareFolderName,
    isFileInDirectory,
    moveFile,
};
