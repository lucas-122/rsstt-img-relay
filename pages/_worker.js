/*
 * https://github.com/netnr/workers
 *
 * 2019-2022
 * netnr
 *
 * https://github.com/Rongronggg9/rsstt-img-relay
 *
 * 2021-2024
 * Rongronggg9
 */

/**
 * Configurations
 */
const config = {
    selfURL: "", // to be filled later
    URLRegExp: "^(\\w+://.+?)/(.*)$",
    // 从 https://sematext.com/ 申请并修改令牌
    sematextToken: "00000000-0000-0000-0000-000000000000",
    // 是否丢弃请求中的 Referer，在目标网站应用防盗链时有用
    dropReferer: true,
    // CDN 防盗链列表
    cdnList: [
        { hosts: [".weibocdn.com", ".sinaimg.cn"], referer: "https://weibo.com/" },
        { hosts: [".sspai.com"], referer: "https://sspai.com/" },
        { hosts: [".bilibili.com", ".hdslb.com"], referer: "https://www.bilibili.com/" },
        { hosts: [".douyin.com", ".iesdouyin.com"], referer: "https://www.douyin.com/" },
        { hosts: [".coolapk.com"], referer: "https://www.coolapk.com/" }
    ],
    // 黑名单，URL 中含有任何一个关键字都会被阻断
    blockList: [],
};

/**
 * Set config from environmental variables
 * @param {object} env
 */
function setConfig(env) {
    Object.keys(config).forEach((k) => {
        if (env[k])
            config[k] = typeof config[k] === 'string' ? env[k] : JSON.parse(env[k]);
    });
}

/**
 * Event handler for fetchEvent
 * @param {Request} request
 * @param {object} env
 * @param {object} ctx
 */
async function fetchHandler(request, env, ctx) {
    ctx.passThroughOnException();
    setConfig(env);

    let reqHeaders = new Headers(request.headers),
        outBody, outStatus = 200, outStatusText = 'OK', outCt = null, outHeaders = new Headers({
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": reqHeaders.get('Access-Control-Allow-Headers') || "Accept, Authorization, Cache-Control, Content-Type, DNT, If-Modified-Since, Keep-Alive, Origin, User-Agent, X-Requested-With, Token, x-access-token"
        });

    try {
        const urlMatch = request.url.match(RegExp(config.URLRegExp));
        config.selfURL = urlMatch[1];
        let url = decodeURIComponent(urlMatch[2]);

        //忽略 OPTIONS 或特殊路径
        if (request.method === "OPTIONS" || url.length < 3 || url.indexOf('.') === -1 || url === "favicon.ico" || url === "robots.txt") {
            const invalid = !(request.method === "OPTIONS" || url.length === 0)
            outBody = JSON.stringify({
                code: invalid ? 400 : 0,
                usage: 'Host/{URL}',
                source: 'https://github.com/Rongronggg9/rsstt-img-relay'
            });
            outCt = "application/json";
            outStatus = invalid ? 400 : 200;
        }
        //阻断黑名单 URL
        else if (blockUrl(url)) {
            outBody = JSON.stringify({
                code: 403,
                msg: 'The keyword: ' + config.blockList.join(' , ') + ' was block-listed by the operator of this proxy.'
            });
            outCt = "application/json";
            outStatus = 403;
        }
        else {
            url = fixUrl(url);

            let fp = { method: request.method, headers: {} };
            const dropHeaders = ['content-length', 'content-type', 'host'];
            if (config.dropReferer) dropHeaders.push('referer');

            for (let [key, value] of reqHeaders.entries()) {
                if (!dropHeaders.includes(key)) {
                    fp.headers[key] = value;
                }
            }

            // 防盗链处理
            if (config.dropReferer) {
                const urlObj = new URL(url);
                for (const cdn of config.cdnList) {
                    if (cdn.hosts.some(h => urlObj.host.endsWith(h))) {
                        fp.headers['referer'] = cdn.referer;
                        break;
                    }
                }
            }

            // 是否带 body
            if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
                const ct = (reqHeaders.get('content-type') || "").toLowerCase();
                if (ct.includes('application/json')) {
                    fp.body = JSON.stringify(await request.json());
                } else if (ct.includes('application/text') || ct.includes('text/html')) {
                    fp.body = await request.text();
                } else if (ct.includes('form')) {
                    fp.body = await request.formData();
                } else {
                    fp.body = await request.blob();
                }
            }

            // 发起 fetch
            let fr = await fetch(url, fp);
            outCt = fr.headers.get('content-type');
            outStatus = fr.status;
            outStatusText = fr.statusText;
            outBody = fr.body;

            const overrideHeaders = new Set(outHeaders.keys());
            for (let [k, v] of fr.headers.entries()) {
                if (!overrideHeaders.has(k))
                    outHeaders.set(k, v);
            }
        }
    } catch (err) {
        outCt = "application/json";
        outBody = JSON.stringify({
            code: -1,
            msg: JSON.stringify(err.stack) || err
        });
        outStatus = 500;
    }

    if (outCt) outHeaders.set("content-type", outCt);
    if (outStatus < 400) outHeaders.set("cache-control", "public, max-age=604800");

    const response = new Response(outBody, {
        status: outStatus,
        statusText: outStatusText,
        headers: outHeaders
    });

    if (config.sematextToken !== "00000000-0000-0000-0000-000000000000") {
        sematext.add(ctx, request, response);
    }

    return response;
}

// 补齐 url
function fixUrl(url) {
    if (url.includes("://")) return url;
    if (url.includes(':/')) return url.replace(':/', '://');
    return "http://" + url;
}

// 阻断黑名单 url
function blockUrl(url) {
    url = url.toLowerCase();
    return config.blockList.some(x => url.includes(x));
}

/**
 * 日志
 */
const sematext = {
    buildBody: (request, response) => {
        const hua = request.headers.get("user-agent");
        const hip = request.headers.get("cf-connecting-ip");
        const hrf = request.headers.get("referer");
        const url = new URL(request.url);

        const body = {
            method: request.method,
            statusCode: response.status,
            clientIp: hip,
            referer: hrf,
            userAgent: hua,
            host: url.host,
            path: url.pathname,
            proxyHost: null,
        }

        if (body.path.includes(".") && body.path !== "/" && !body.path.includes("favicon.ico")) {
            try {
                let purl = fixUrl(decodeURIComponent(body.path.substring(1)));
                body.path = purl;
                body.proxyHost = new URL(purl).host;
            } catch { }
        }

        return {
            method: "POST",
            body: JSON.stringify(body)
        }
    },

    add: (event, request, response) => {
        let url = `https://logsene-receiver.sematext.com/${config.sematextToken}/example/`;
        const body = sematext.buildBody(request, response);
        event.waitUntil(fetch(url, body));
    }
};

export default {
    fetch: fetchHandler
};
