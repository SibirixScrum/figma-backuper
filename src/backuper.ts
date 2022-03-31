import { LinksToProjectsAndTeams, LinkToFolder, Report, User } from './types';

const WebDriver = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const path = require('chromedriver').path;

const selector = require('./selectors');
const fsHelper = require('./fsHelper');
const mailer = require('./mailer');
const api = require('./apiHelper');
const config = require('../config.json');

// Указываем путь до chromedriver'а внутри node_modules
const service = new chrome.ServiceBuilder(path).build();
chrome.setDefaultService(service);

/**
 *
 */
class Backuper {

    private user: User[];

    // использованые имена файлов
    private titles: Set<any>;

    // максимальное время ожидания появления элемента, 1 минута
    private delayElement: number = 60 * 1000;
    // максимальное время ожидания скачивания файла, 5 минут
    private delayFileDownload: number = 5 * 60 * 1000;

    // За какое время скачивать файлы при частичном бекапе и при использовании --auto-incremental в день частичного бекапа
    private hoursForPartialBackup: number = 48; // количество часов
    // За какое время скачивать файлы при использовании --auto-incremental в день полного бекапа
    private daysForAutoIncrementalBackup: number = 8; // количество дней
    private MAX_TRIES = 10;

    // период проверки появления файла в каталоге
    private period: number = 500;

    private urlFigma: string = 'https://www.figma.com/login';
    private urlRecent: string = 'https://www.figma.com/files/recent';
    private baseFolder: string;

    private currentReportData: Report;
    private reportsData: Report[] = [];
    private totalTime: string = '';
    private options: any;

    private webdriver: any;

    constructor(options) {
        this.options = options;
        this.titles = new Set();
        this.baseFolder = config.baseFolder;
        this.user = config.user;
        this.hoursForPartialBackup = parseInt(config.hoursForPartialBackup, 10);
        this.daysForAutoIncrementalBackup = parseInt(config.daysForAutoIncrementalBackup, 10);

        if (config.delayFileDownloadSeconds) {
            const delay = parseInt(config.delayFileDownloadSeconds, 10);

            if (!isNaN(delay) && delay >= 60) {
                this.delayFileDownload = delay * 1000;
            }
        }

        if (this.options.autoIncremental) {
            const weekDayNumber = (new Date()).getDay();

            if (weekDayNumber === 6) {
                this.hoursForPartialBackup = this.daysForAutoIncrementalBackup * 24;
            }
        }
    }

    /**
     *
     */
    async doBackup() {
        if (this.options.verbose) console.log('Backup started');

        // await this.debugWebGl(); return; // отладка, смотрим есть ли в используемом хроме поддержка WebGL

        const timeStart = Date.now();

        for (let i = 0; i < this.user.length; i++) {
            const timeStartOne = Date.now();
            await this.backupOneUser(this.user[i]);
            const timeForOne = this.formatTime((Date.now() - timeStartOne) / 1000);
            this.currentReportData.statistics.push('Total time used: ' + timeForOne);

            this.reportsData.push(this.currentReportData);
        }

        const timeForAll = this.formatTime((Date.now() - timeStart) / 1000);
        this.totalTime = 'Total time used: ' + timeForAll;

        await this.sendReport(this.reportsData);
    }

    async backupOneUser(user: User) {
        if (this.options.verbose) console.log(`Backup for user ${user.login} started`);

        this.currentReportData = {
            login: user.login,
            filesShouldBe: 0,
            filesSaved: 0,
            errors: [],
            statistics: [],
        };

        await this.getWebdriver(user, true);

        if (user.teams.length) {
            await this.backupProjectsAndTeams(user);
        }

        if (user.downloadRecent) {
            await this.backupRecent(user);
        }

        const webdriver = await this.getWebdriver(user);
        await webdriver.close();

        if (this.options.verbose) console.log(`Backup for user ${user.login} done`);
    }

    async backupProjectsAndTeams(user: User) {
        if (this.options.verbose) console.log('Backup all projects and teams, start');

        let linksToFolders: LinkToFolder[] = [];

        // получаем ссылки на файлы, измененные менее X часов назад
        let figmaApiLinks = [] as LinksToProjectsAndTeams[];
        try {
            figmaApiLinks = await this.getUserLinks(user);
        } catch (e) {
            if (this.options.debug || this.options.verbose) console.log(`${user.login} Ошибка получения списка файлов!`);
            if (this.options.debug) console.log(e);

            this.currentReportData.errors.push(`${user.login} Ошибка получения списка файлов!`);

            return;
        }

        if (this.options.debug) console.log({
            linkCount: figmaApiLinks.length,
            links: figmaApiLinks.map((link) => link.link)
        });

        // Папка для бекапа
        const userFolder = fsHelper.prepareFolderName(this.baseFolder, user.login);

        for (let i = 0; i < figmaApiLinks.length; i++) {
            let projectFolder = fsHelper.prepareFolderName(userFolder, figmaApiLinks[i].team.name, figmaApiLinks[i].project.name);
            fsHelper.createFolder(projectFolder);

            linksToFolders.push({
                link: figmaApiLinks[i].link,
                folder: projectFolder,
                tries: 0,
            });
        }

        this.currentReportData.filesShouldBe += figmaApiLinks.length;

        if (linksToFolders.length) {
            // сохранение всех файлов
            await this.startFilesDownload(linksToFolders);
        }

        if (this.options.verbose) console.log('Backup all projects and teams, done');
    }

    async backupRecent(user: User) {
        if (this.options.verbose) console.log('Backup recent, start');

        const webdriver = await this.getWebdriver(user);
        await webdriver.get(this.urlRecent);

        // дождаться загрузки страницы
        await webdriver.sleep(2000);

        if (this.options.debug) console.log('    waitForElementAndGet', selector.recentFilesSelector);
        const recentRows = await this.waitForElementAndGet(selector.recentFilesSelector, true);

        const regexpTitle = /<div[^>]+class[^>]+generic_tile--title[^>]+>([^<]+)<\/div>/;
        const regexpTime = /Edited[^<]*<span[^>]*>([^<]+)<\/span>/;
        const regexpTimeParts = /(?<num>\d+|last)\s(?<type>minute|hour|day|month|year)s?(\sago)?/;
        // Временны екоэффициенты, относительно 1 минуты
        const timeKoeffs = {
            'minute': 1,
            'hour': 60,
            'day': 60 * 24,
            'month': 60 * 24 * 30,
            'year': 60 * 24 * 365,
        };

        const userFolder = fsHelper.prepareFolderName(this.baseFolder, user.login);
        let recentFolder = fsHelper.prepareFolderName(userFolder, "Recent");
        fsHelper.createFolder(recentFolder);

        let linksToFolders: LinkToFolder[] = [];

        for (let i = 0; i < recentRows.length; i++) {
            recentRows[i].click();
            await webdriver.sleep(5);
            const href = await recentRows[i].getAttribute('href');
            const html = await recentRows[i].getAttribute('innerHTML');
            const linkObj = {
                link:   href,
                folder: recentFolder,
                tries:  0,
            };

            const matchTitle = html.match(regexpTitle)[1];
            const matchTime = html.match(regexpTime)[1];

            if (this.options.all) {
                linksToFolders.push(linkObj);
            } else if (matchTime) {
                // Пробуем распарсить текстовую дату и понять, надо ли скачивать файл
                // matchTime: "yesterday", "2 years ago", "last year", "16 hours ago", "20 days ago", "1 hour ago", "4 months ago"
                let minutesSinceUpdate = 0;
                if (matchTime === 'yesterday') {
                    if (this.options.debug) console.log("Time: " + matchTime);
                    minutesSinceUpdate = 60 * 24;
                } else {
                    const timeParts = matchTime.match(regexpTimeParts);
                    if (this.options.debug) console.log("Time: " + matchTime, "AS: ", timeParts);
                    minutesSinceUpdate = (timeKoeffs[timeParts.groups.type] ? timeKoeffs[timeParts.groups.type] : 1)
                        * parseInt(timeParts.groups.num === 'last' ? 1 : timeParts.groups.num);
                }

                if (minutesSinceUpdate <= this.hoursForPartialBackup * 60) {
                    linksToFolders.push(linkObj);
                }
            }
        }

        if (linksToFolders.length) {
            // сохранение всех файлов
            this.currentReportData.filesShouldBe += linksToFolders.length;
            await this.startFilesDownload(linksToFolders);
        }

        if (this.options.verbose) console.log('Backup recent, done');
    }

    /**
     *
     */
    async startFilesDownload(linksToFolders: LinkToFolder[]) {
        let currentArray = linksToFolders;

        for (let currentTry = 0; currentTry < this.MAX_TRIES; currentTry++) {
            let newArray: LinkToFolder[] = [];

            for (let i = 0; i < currentArray.length; i++) {
                const timeStart = Date.now();
                const result = await this.downloadOneFile(currentArray[i]);

                if (this.options.verbose) {
                    const timeForOne = this.formatTime((Date.now() - timeStart) / 1000);
                    const title = this.getTitle(currentArray[i]);
                    this.currentReportData.statistics.push((result ? 'Скачал ' : 'НЕ СКАЧАЛ ') + title + ' за ' + timeForOne);
                }

                if (!result) {
                    newArray.push({
                        ...currentArray[i],
                        tries: currentArray[i].tries + 1
                    });
                }
            }

            currentArray = newArray;
            if (newArray.length === 0) {
                break;
            } else {
                if (this.options.verbose) {
                    this.currentReportData.statistics.push('===== Следующая итерация попыток скачивания =====');
                }
            }
        }

        this.currentReportData.filesSaved = linksToFolders.length - currentArray.length;
        if (currentArray.length > 0) {
            for (let i = 0; i < currentArray.length; i++) {
                this.currentReportData.errors.push('Can\'t download ' + currentArray[i].link);
            }
        }
    }

    /**
     * составить html для отправки и отправить
     */
    async sendReport(reports: Report[]) {
        let goodHTML = '<h1 style="color:green">#USER#: Все ОК</h1>';
        let partlyHTML = '<h1 style="color:yellow">#USER#: ОК, но с предупреждениями</h1>';
        let badHTML = '<h1 style="color:red">#USER#: Не ОК</h1>';

        const fullReport: string[] = [];
        for (let i = 0; i < reports.length; i++) {
            const report = reports[i];
            const isDownloadedAll = (report.filesSaved == report.filesShouldBe);
            const hasErrors = (report.errors.length > 0);

            const errorsCount = report.errors.length;
            const errors = report.errors.join("<br>\n");

            const statistics = this.options.verbose ? report.statistics.join('<br>') : '';

            if (!report.filesShouldBe) {
                const hours = this.hoursForPartialBackup;
                const text = this.options.all ? 'Списов файлов пуст!' : `За последние ${hours}ч нет изменённых файлов.`;
                fullReport.push(`<h1>${report.login}: ${text}</h1>`);

            } else {
                const header = (isDownloadedAll ? (hasErrors ? partlyHTML : goodHTML) : badHTML)
                    .replace('#USER#', report.login);

                fullReport.push(header + `
                    <p>сохранено файлов в проектах: ${report.filesSaved}/${report.filesShouldBe}</p>
                    <hr>
                    <p>${statistics}</p>
                    <hr>
                    <p>Ошибки: ${errorsCount}</p>
                    <p>${errors}</p>
                `);
            }
        }

        await mailer.sendEmail(fullReport.join("<br><hr><hr>\n<br>\n") + "<br>\n<br>\n" + this.totalTime);
    }

    /**
     * получить ссылки на нужные файлы для одного пользователя
     */
    async getUserLinks(user: User): Promise<LinksToProjectsAndTeams[]> {
        return await api.createLinksToFiles(user.teams, user.token, this.options.all, this.hoursForPartialBackup);
    }

    /**
     * сохранить один файл
     */
    async downloadOneFile(linkToFolder: LinkToFolder): Promise<Boolean> {
        if (this.options.verbose) console.log('downloadOneFile start', linkToFolder.link);

        const driver = await this.getWebdriver();

        // делаем название файла из ссылки
        const title = this.getTitle(linkToFolder);

        // открываем ссылку на файл, который нужно скачать
        if (this.options.debug) console.log('    driver.get(link)', linkToFolder.link);
        await driver.get(linkToFolder.link);
        if (this.options.debug) console.log('    driver.get(link) wait');
        await driver.sleep(200);
        if (this.options.debug) console.log('    driver.get(link) done');

        const timeStart = Date.now();
        try {
            // ждем загрузки страницы проверкой наличия элемента
            await driver.sleep(2000); // Ждём 2 секунды ибо фигма глючит часто
            await this.waitForElementAndGet(selector.folderNameInFile);
            const timeForOne = this.formatTime((Date.now() - timeStart) / 1000);
            if (this.options.debug) console.log('    waitForElementAndGet done ' + timeForOne, selector.folderNameInFile);

        } catch (exception) {
            const timeForOne = this.formatTime((Date.now() - timeStart) / 1000);

            if (this.options.debug) {
                console.log('    waitForElementAndGet error' + ' ' + linkToFolder.link + ' ' + timeForOne, selector.folderNameInFile);
                console.log(exception);

                const element = await this.webdriver.wait(
                    WebDriver.until.elementLocated(WebDriver.By.css('html')),
                    500
                );
                try {
                    const html = await element.getAttribute('innerHTML');
                    console.log(html);
                } catch (e) {
                    console.log('CANT GET HTML');
                }
            }

            this.currentReportData.errors.push(`exception ${selector.folderNameInFile}, ${linkToFolder.link}, ${timeForOne}`);
            // неуспешный результат, в отчете будет показан как "есть ошибки"
            return false;
        }

        return await this.saveToDisk(title, linkToFolder.folder);
    }

    getTitle(linkToFolder: LinkToFolder) {
        const splitedLink = linkToFolder.link.split('/');
        const splitLinkSecond = splitedLink[splitedLink.length - 1].split('?');
        const splitLinkThird = splitLinkSecond[splitLinkSecond.length - 1].split('%2F');

        return splitLinkThird.join('_').replace('/\|/g', '_');
    }

    /**
     *
     */
    async saveToDisk(title: string, folder: string): Promise<Boolean> {
        try {
            // сохранение файла
            const html = await this.webdriver.findElement(WebDriver.By.css("html"));

            await html.sendKeys(WebDriver.Key.CONTROL + "/");
            await this.webdriver.sleep(200);

            const input = await this.webdriver.findElement(WebDriver.By.css(selector.quickActionsInput));
            if (this.options.debug) console.log('Opened "Quick actions" input');

            await input.sendKeys("Save local");

            await this.webdriver.sleep(200);
            await input.sendKeys(WebDriver.Key.ENTER);

            if (this.options.debug) console.log('Send "Save local" command, waiting for file');

            // чтобы файл успел скачаться
            let count = Math.round(this.delayFileDownload / this.period);
            const success = await this.waitExistenceOfFile(count, title, folder);

            // надеемся, что файл с дефолтным, вероятно, повторяющимся названием, тоже успеет скачаться
            if (title === 'Untitled') this.webdriver.sleep(this.period * 2);

            if (this.options.debug && !success) {
                const element = await this.webdriver.wait(
                    WebDriver.until.elementLocated(WebDriver.By.css('html')),
                    500
                );
                try {
                    const html = await element.getAttribute('innerHTML');
                    console.log(html);
                } catch (e) {
                    console.log('CANT GET HTML');
                }
            }

            return success;

        } catch (StaleElementReferenceException) {
            this.currentReportData.errors.push(`StaleElementReferenceException "html"`);
            // неуспешный результат, в отчете будет показан как "есть ошибки"
            return false;
        }
    }

    /**
     *
     */
    wasTitleUsed(title: string) {
        for (let item of this.titles) if (item === title) return true;
        return false;
    }

    /**
     * ожидание, пока файл с нужным именем появится в каталоге
     */
    async waitExistenceOfFile(count: number, title: string, folder: string) {
        let titleWithFolder = `${title} ${folder}`;
        const tmpFolder = fsHelper.prepareFolderName(this.baseFolder, 'temp');

        if (this.wasTitleUsed(titleWithFolder)) {
            let i = 1;
            let newTitle: string = '';
            let newTitleWithFolder: string = '';
            let postfix: string = '';

            do {
                postfix = `(${i++})`;
                newTitle = `${title} ${postfix}`;
                newTitleWithFolder = `${title} ${postfix} ${folder}`;
            } while (this.wasTitleUsed(newTitleWithFolder));

            title = newTitle;
            titleWithFolder = newTitleWithFolder;
        }

        do {
            count--;
            if (fsHelper.isFileInDirectory(tmpFolder, title)) {
                fsHelper.moveFile(tmpFolder, folder, title);
                return true;
            }
            await this.webdriver.sleep(this.period);
        } while (count > 0);

        if (this.options.verbose) console.log(title + ' не скачался');
        return false;
    }

    /**
     * войти под пользователем
     */
    async login(user: User, driver) {
        await driver.get(this.urlFigma);
        // дождаться загрузки страницы
        if (this.options.debug) console.log('    waitForElementAndGet', selector.authBlock);
        await this.waitForElementAndGet(selector.authBlock);
        if (this.options.debug) console.log('    waitForElementAndGet done', selector.authBlock);

        const emailInput    = await this.waitForElementAndGet(selector.authFieldLogin);
        const passwordInput = await this.waitForElementAndGet(selector.authFieldPassword);
        const loginButton   = await this.waitForElementAndGet(selector.loginLink);

        if (this.options.debug) console.log('    waitForElementAndGet (email, pass, btn) done');

        // напечатать логин
        await emailInput.sendKeys(user.login);

        // напечатать пароль
        await passwordInput.sendKeys(user.password);

        await loginButton.click();
        if (this.options.debug) console.log('    loginButton clicked');

        // ждем, что откроется страница с проектами
        try {
            await this.waitForElementAndGet(selector.menuLinkDrafts);
        } catch (exception) {
            if (this.options.debug) {
                console.log('    waitForElementAndGet error ' + selector.menuLinkDrafts);
                console.log(exception);

                const element = await this.webdriver.wait(
                    WebDriver.until.elementLocated(WebDriver.By.css('html')),
                    500
                );
                try {
                    const html = await element.getAttribute('innerHTML');
                    console.log(html);
                } catch (e) {
                    console.log('CANT GET HTML');
                }
            }

            this.currentReportData.errors.push(`Cant load projects page!`);
            throw exception;
        }

        if (this.options.debug) console.log('    projects page opened');
    }

    /**
     * дождаться пока появится элемент и вернуть его
     */
    async waitForElementAndGet(selector: string, multiple: boolean = false) {
        const element = await this.webdriver.wait(
            WebDriver.until.elementLocated(WebDriver.By.css(selector)),
            this.delayElement
        );

        await this.webdriver.wait(
            WebDriver.until.elementIsVisible(element),
            this.delayElement
        );

        if (multiple) {
            return await this.webdriver.findElements(WebDriver.By.css(selector));
        } else {
            return await this.webdriver.findElement(WebDriver.By.css(selector));
        }
    }

    /**
     * создать новую сессию и новый драйвер с новым каталогом для сохранения
     */
    createSessionNewDriver(folderName: String = this.baseFolder) {
        const chromeCapabilities = WebDriver.Capabilities.chrome();
        chromeCapabilities.set('goog:chromeOptions', {
            'args': [
                '--test-type',
                '--start-maximized',
                '--headless',
                '--no-sandbox',
                '--log-level=' + (this.options.debug ? '1' : (this.options.verbose ? '2' : '3')),
                // '--disable-gpu',
                // '--disable-dev-shm-usage',
                '--ignore-gpu-blacklist',
                '--use-gl',
                // '--disable-web-security',
                // 'user-data-dir=' + folderName,
            ],
            'prefs': {
                'download': {
                    'default_directory': folderName,
                    'prompt_for_download': 'false'
                }
            }
        });

        return new WebDriver.Builder()
            .withCapabilities(chromeCapabilities)
            .build();
    }

    /**
     * создать новую сессию и новый драйвер с новым каталогом для сохранения
     */
    async getWebdriver(user: null|User = null, force = false) {
        if (this.webdriver && !force) return this.webdriver;

        this.webdriver = this.createSessionNewDriver(fsHelper.prepareFolderName(this.baseFolder, 'temp'));

        if (this.options.debug) console.log('    WebDriver autosave folder: ' + fsHelper.prepareFolderName(this.baseFolder, 'temp'));

        if (user) {
            if (this.options.debug) console.log('    login');
            await this.login(user, this.webdriver);
            if (this.options.debug) console.log('    login done');
        }

        return this.webdriver;
    }

    async debugWebGl() {
        const driver = await this.createSessionNewDriver('');
        await driver.get('https://webglreport.com/');
        await driver.sleep(1000);
        const element = await driver.wait(
            WebDriver.until.elementLocated(WebDriver.By.css('html')),
            500
        );
        const html = await element.getAttribute('innerHTML');
        console.log(html);
        await driver.close();
        return;
    }

    formatTime (seconds) {
        let sec = Math.round(seconds);
        let minutes = Math.floor(sec / 60);
        sec = (sec % 60);
        let hours = Math.floor(minutes / 60);
        minutes = (minutes % 60);

        return (hours ? hours + 'ч ' : '')
            + (minutes ? minutes + 'мин ' : '')
            + (sec + 'сек');
    }
}

module.exports = Backuper;
