export class WebElement {
    getText: () => string
}

// класс отчета пользователя
export class Report {
    login: string;
    filesShouldBe: number;
    filesSaved: number;
    errors: string[];
    statistics: string[];
}

// класс файла, перезупущенного после неудачного скачивания
export class Restarted {
    title:string;
    timesRestarted: number;
    success: boolean;
    userLogin: string;
    sycleCount: number;
    link: string;
}

export class Team {
    id: string;
    name: string;
}

export class User {
    login: string;
    password: string;
    token: string;
    downloadRecent: boolean;
    teams: Team[];
}

export class LinkToFolder {
    link: string;
    folder: string;
    tries: number;
}

export class ResultToUser {
    res: boolean;
    user: User;
}

// apiHelper
export class FigmaTeam {
    id: string;
    name: string;
}

export class FigmaFile {
    key: string;
    name: string;
    thumbnail_url: string;
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
