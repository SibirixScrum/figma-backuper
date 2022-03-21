// класс отчета пользователя
export class Report {
    login: string;
    filesShouldBe: number;
    filesSaved: number;
    errors: string[];
    statistics: string[];
}

export class Team {
    id: string;
    name: string;
}

export class User {
    login: string;
    password: string;
    token: string;
    teams: Team[];
}

export class LinkToFolder {
    link: string;
    folder: string;
    tries: number;
}

// apiHelper
export class FigmaTeam {
    id: string;
    name: string;
}

export class FigmaFile {
    key: string;
    name: string;
    last_modified: string;
}
export class FigmaProject {
    id: Number;
    name: string;
}

export class ProjectToTeams {
    project: FigmaProject;
    team: FigmaTeam;
}

export class FilesToProjects {
    file: FigmaFile;
    projectId: string;
}

export class FilesToProjectsAndTeams {
    file: FigmaFile;
    project: FigmaProject;
    team: FigmaTeam;
}

export class LinksToProjectsAndTeams {
    link: string;
    project: FigmaProject;
    team: FigmaTeam;
}
