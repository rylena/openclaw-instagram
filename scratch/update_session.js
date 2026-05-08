import fs from 'node:fs';
import path from 'node:path';

const sessionid = "31813589433%3AsUSJefatn34xBt%3A5%3AAYg0eMFg_qIAITv8WNe5tAoTdaA2tKdl6Wo_ddOOgw";
const ds_user_id = "31813589433";
const csrftoken = "OOLRzLxmGoSxwIr2xsOJvpAFCc3umQ8t";

const sessionPath = "/home/ayu/.instagram-cli/users/theayuchauhan/session.ts.json";

try {
    const rawData = fs.readFileSync(sessionPath, 'utf8');
    const session = JSON.parse(rawData);

    // Update cookies
    const cookieData = JSON.parse(session.cookies);
    cookieData.cookies = [
        {
            key: "sessionid",
            value: sessionid,
            domain: "instagram.com",
            path: "/",
            secure: true,
            httpOnly: true,
            hostOnly: false,
            creation: new Date().toISOString(),
            lastAccessed: new Date().toISOString()
        },
        {
            key: "ds_user_id",
            value: ds_user_id,
            domain: "instagram.com",
            path: "/",
            secure: true,
            hostOnly: false,
            creation: new Date().toISOString(),
            lastAccessed: new Date().toISOString()
        },
        {
            key: "csrftoken",
            value: csrftoken,
            domain: "instagram.com",
            path: "/",
            secure: true,
            hostOnly: false,
            creation: new Date().toISOString(),
            lastAccessed: new Date().toISOString()
        }
    ];
    session.cookies = JSON.stringify(cookieData);

    // Update authorization header
    const authPayload = {
        ds_user_id: ds_user_id,
        sessionid: sessionid
    };
    const authBase64 = Buffer.from(JSON.stringify(authPayload)).toString('base64');
    session.authorization = `Bearer IGT:2:${authBase64}`;

    fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf8');
    console.log("Successfully updated session file.");
} catch (error) {
    console.error("Error updating session file:", error.message);
    process.exit(1);
}
