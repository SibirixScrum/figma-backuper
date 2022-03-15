const nodemailer = require("nodemailer");
const configMail = require('../config.json');

const sendEmail = async (html: string) => {
    if (configMail.transporter && configMail.receivers && configMail.receivers.length > 0) {
        let transporter = nodemailer.createTransport(configMail.transporter);

        let info = await transporter.sendMail({
            from: configMail.transporter.auth.user,
            to: configMail.receivers,
            subject: "Отчет бекапера Фигмы",
            html: html
        });

        console.log("Message sent: %s", info.messageId);
    } else {
        console.log("No email report configured");
        console.log(html);
    }

};

module.exports = {
    sendEmail
};
