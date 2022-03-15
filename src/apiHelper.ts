import {
    FigmaFile,
    FigmaProject,
    FilesToProjects,
    FilesToProjectsAndTeams,
    LinksToProjectsAndTeams,
    ProjectToTeams
} from './types';

const axios = require('axios');

const urlApi = 'https://api.figma.com/v1/';
const urlFile = 'https://www.figma.com/file/';
const configApi = require('../config.json');
const MAX_TRIES = 10;

/**
 * получить проекты одной команды
 */

// {{API_URL}}teams/{{TEAM_ID}}/projects
// https://api.figma.com/v1/teams/971593941299334989/projects

const getProjectsByTeam = async (team: {id: string, name: string}, token: string) => {

    // АПИ фигмы, сука, падает по таймауту. Дрочим его 10 попыток, в надежде, что эта сцуко ответит
    for (let i = 0; i < MAX_TRIES; i++) {
        try {
            const response = await axios.get(
                `${urlApi}teams/${team.id}/projects`,
                {
                    headers: {'X-FIGMA-TOKEN': token}
                }
            );

            return response.data.projects;
        } catch (e) {
            // упало...
            console.log(`!!! ${urlApi}teams/${team.id}/projects axios error`);

            if (i >= MAX_TRIES - 1) {
                // Если упало много раз - пробрасываем ошибку выше
                throw e;
            }
        }
    }

    return false;
};

/**
 * получить проекты для всех команд
 */
const getAllProjects = async (teams: {id: string, name: string}[], token: string) => {
    let projects: FigmaProject[] = [];
    let projectToTeams: ProjectToTeams[] = [];

    for (let i = 0; i < teams.length; i++) {
        try {
            const newProj = await getProjectsByTeam(teams[i], token);
            projects = [...projects,...newProj];
            newProj.forEach((f) => {
                projectToTeams.push({ project: f, team: teams[i] });
            });
        } catch (error) {
            console.log(error);
        }
    }

    return projectToTeams;
};

/**
 * получить список файлов для одного проекта
 */
const getProjectFiles = async (projectId: string, token: string) => {
    // АПИ фигмы, сука, падает по таймауту. Дрочим его 10 попыток, в надежде, что эта сцуко ответит
    for (let i = 0; i < MAX_TRIES; i++) {
        try {
            const response = await axios.get(
                `${urlApi}projects/${projectId}/files`,
                {
                    headers: { 'X-FIGMA-TOKEN': token }
                }
            );

            return response.data.files;

        } catch (e) {
            // упало...
            console.log(`!!! ${urlApi}projects/${projectId}/files axios error`);

            if (i >= MAX_TRIES - 1) {
                // Если упало много раз - пробрасываем ошибку выше
                throw e;
            }
        }
    }

    return false;
};

/**
 * массив файлов в проекте, которые стоит сохранить
 */
const filesInProjectWorthVisiting = async (projectId: string, token: string, getAllFiles = false, hoursToGetOld = 0) => {
    const worthFiles: FigmaFile[] = [];

    const files: FigmaFile[] = await getProjectFiles(projectId, token);
    // если указано что нужно сохранять все файлы вне зависимости от даты модификации
    if (getAllFiles) {
        return files;
    }

    for (let i = 0; i < files.length; i++) {
        if (checkDateModified(files[i].last_modified, hoursToGetOld)) {
            worthFiles.push(files[i]);
        }
    }

    return worthFiles;
};

/**
 * возвращает true если файл был модифицирован менее X часов назад
 */
const checkDateModified = (date: string, hoursToGetOld = 0) => {
    let dateModified = Date.parse(date);

    if (isNaN(dateModified)) {
        console.log('Дата не распознана ' + date);
        return false;
    }

    let lastDateToModify = new Date();
    lastDateToModify.setHours(lastDateToModify.getHours() - hoursToGetOld);
    const lastTimeToModify = lastDateToModify.getTime();

    return dateModified > lastTimeToModify;
};

/**
 * получить все файлы, которые стоит сохранить во всех проектах
 */
const getFilesToVisit = async (projectIds: string[], token: string, getAllFiles = false, hoursToGetOld = 0) => {
    let worthFiles: FigmaFile[] = [];
    let filesToProjects: FilesToProjects[] = [];

    for (let i = 0; i < projectIds.length; i++) {
        const newFiles = await filesInProjectWorthVisiting(projectIds[i], token, getAllFiles, hoursToGetOld);
        worthFiles = [...worthFiles, ...newFiles];
        newFiles.forEach((f) => {
            filesToProjects.push({ file: f, projectId: projectIds[i] });
        });
    }

    return filesToProjects;
};

/**
 * получить все файлы, которые нужно сохранить, во всех командах
 */
const getFilesByTeams = async (teams: {id: string, name: string}[], token: string, getAllFiles = false, hoursToGetOld = 0) => {
    const projectsLinkedToTeams = await getAllProjects(teams, token);
    const projectIds = projectsLinkedToTeams.map((f) => f.project.id.toString());
    const filesLinkedToProjects = await getFilesToVisit(projectIds, token, getAllFiles, hoursToGetOld);

    return linkFilesAndTeams(projectsLinkedToTeams, filesLinkedToProjects);
};

/**
 * соединить файлы с соответствующими командами
 */
const linkFilesAndTeams = (projectsTeams: ProjectToTeams[], filesToProjects: FilesToProjects[]) => {
    let filesToProjectsAndTeams: FilesToProjectsAndTeams[] = [];

    for (let i = 0; i < filesToProjects.length; i++) {
        for (let j = 0; j < projectsTeams.length; j++) {
            if (projectsTeams[j].project.id.toString() === filesToProjects[i].projectId) {
                filesToProjectsAndTeams.push({
                    file: filesToProjects[i].file,
                    project: projectsTeams[j].project,
                    team: projectsTeams[j].team
                });
                break;
            }
        }
    }

    return filesToProjectsAndTeams;
};

/**
 * получить массив ссылок, по которым нужно пройтись, чтобы сохранить все недавно (23 часа) модифицированые файлы
 */
async function createLinksToFiles(teams: {id: string, name: string}[], token: string, getAllFiles = false, hoursToGetOld = 0): Promise<LinksToProjectsAndTeams[]> {
    const filesToProjectsAndTeams = await getFilesByTeams(teams, token, getAllFiles, hoursToGetOld);

    return filesToProjectsAndTeams.map((f) => {
        let splitedLink = f.file.name.split('/');
        let name = splitedLink.join('%2F');

        return {
            link: `${urlFile}${f.file.key}/${name}`,
            project: f.project,
            team: f.team
        }
    });
}

module.exports = {
    createLinksToFiles
};
