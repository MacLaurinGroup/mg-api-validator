"use strict;"

const fs = require("fs");
const axios = require("axios");
const jwt = require("jsonwebtoken");


module.exports = class ClassBaseTest {

  constructor(metaData, localPath) {
    this.localPath = localPath;
    this.metaData = metaData;
    this.testResult = {
      name: (this.metaData.name) ? this.metaData.name : "Test-XXX",
      ran: false,
      passed: false,
      networkTimeMs: 0,
      testTimeMs: 0,
      bytes: 0,
      error: []
    };

    // Default some values
    this.metaData.response.status = this.metaData.response.status ? this.metaData.response.status : -1;
    this.metaData.response.contentType = this.metaData.response.contentType ? this.metaData.response.contentType : "json";
    this.metaData.stopOnFail = this.metaData.stopOnFail ? this.metaData.stopOnFail : false;
    this.metaData.skipTest = this.metaData.skipTest ? this.metaData.skipTest : false;

  }

  /** -------------------------------------------------------------
   * Executes the test internally
   * 
   * @param {*} env 
   */
  async execute(context) {
    if ( this.metaData.skipTest ){
      return this.testResult;
    }

    const request = this._getRequestData(context);
    const startDate = new Date().getTime();
    context.env.__time = startDate;

    try {
      const response = await axios.request(request);
      this.testResult.networkTimeMs = new Date().getTime() - startDate;

      this._validateResponse(context, response, request);
    } catch (error) {
      if (error.response) {
        this.testResult.networkTimeMs = new Date().getTime() - startDate;
        this._validateResponse(context, error.response, request);
      } else {
        console.log(error)
      }
    } finally {
      this.testResult.testTimeMs = new Date().getTime() - startDate;
    }

    delete context.env.response;
    return this.testResult;
  }


  //-------------------------------------------------------------

  _getRequestData(env) {
    let req = {};

    if (env.httpDefaults) {
      req = Object.assign({}, env.httpDefaults);
    }
    req.headers = {};

    // do the url
    const url = this._evaluate(env.env, this.metaData.request.url);
    if (url.split(" ").length === 2) {
      req.method = url.split(" ")[0];
      req.url = url.split(" ")[1];
    } else {
      req.method = "GET";
      req.url = url;
    }

    // do the headers
    if (env.headers) {
      req.headers = Object.assign(req.headers, env.headers);
    }

    if (this.metaData.request.headers) {
      req.headers = Object.assign(req.headers, this._evaluate(env.env, this.metaData.request.headers));
    }

    // do the params
    if (this.metaData.request.params) {
      req.params = this.metaData.request.params;
    }

    // do the body
    if (this.metaData.request.body) {
      req.data = this._evaluate(env.env, this.metaData.request.body);
    }

    return req;
  }


  //-------------------------------------------------------------

  _evaluate(env, obj, prefix) {
    if (typeof obj === "string") {
      const rxp = /\${([^}]+)}/g;
      let curMatch;

      while (curMatch = rxp.exec(obj)) {

        if (typeof prefix != "undefined") {
          if (!curMatch[1].startsWith(prefix)) {
            curMatch[1] = prefix + curMatch[1];
          }
        }

        const evaluated = eval(curMatch[1]);
        obj = obj.substring(0, curMatch.index) + evaluated + obj.substring(curMatch.index + curMatch[0].length);
      }

    } else if (Array.isArray(obj)) {

      for ( let x=0; x < obj.length; x++ ){
        obj[x] = this._evaluate( env, obj[x] );
      }

    } else if (typeof obj === "object") {
      obj = Object.assign({}, obj);
      this._evaluateMap(env, obj);
    }

    return obj;
  }

  //-------------------------------------------------------------

  _evaluateMap(env, map) {
    const keys = Object.keys(map);
    for (const key of keys) {
      if (typeof map[key] === "string") {
        map[key] = this._evaluate(env, map[key]);
      } else if (typeof map[key] === "object") {
        this._evaluate(env, map[key]);
      }
    }
  }

  //-------------------------------------------------------------

  _extractJWT(env, data) {
    if (typeof data === "undefined" || typeof this.metaData.response.extractJWT === "undefined") {
      return true;
    }

    const val = this._evaluate(env, this.metaData.response.extractJWT);
    if (val === "undefined") {
      this.testResult.error.push("extractJWT: [" + this.metaData.response.extractJWT + "]: not found");
    }

    try {
      env.jwtData = jwt.decode(val);
    } catch (e) {
      this.testResult.error.push("extractJWT: error decoding JWT packet: " + e);
    }

    return (this.testResult.error.length === 0);
  }

  //-------------------------------------------------------------

  __getData(key, data) {

    try {

      if (key.startsWith("data[") || key.startsWith("data.")) {
        // full path
        return eval(key);
      } else {
        if (key.startsWith("'") && key.endsWith("'")) {
          return eval("data[" + key + "]");
        } else {
          return eval("data." + key);
        }
      }

    } catch (e) {
      return UNDEFINED_OBJ;
    }
  }


  //-------------------------------------------------------------

  async logError(context, request, response) {
    if (context.logDir == null) {
      return;
    }

    if (!fs.existsSync(context.logDir)) {
      fs.mkdirSync(context.logDir);
    }

    this.logFileName = context.logDir + "/" + this.testResult.name
      .replace(/\//g, "--") 
      .replace(/ /g, "_")
      .replace(/\'/g, "_")
      .replace(/"/g, "_")
      .replace(/:/g, "_")
      .replace(/{/g, "(")
      .replace(/}/g, "(")
      .replace(/\\/g, "(") + ".json";

    try {
      const fileBody = JSON.stringify({
        response: {
          status: response.status ? response.status : null,
          data: response.data ? response.data : null
        },
        request: {
          url: request.url,
          method: request.method,
          headers: request.headers,
          data: request.data ? request.data : ""
        },
        env : context.env
      }, null, "  ");

      fs.writeFileSync(this.logFileName, fileBody);
    } catch (e) {
      console.error(e);
    }
  }

  //-------------------------------------------------------------

  getBannerStart() {
    return `--\\\\ ${this.testResult.name}`;
  }

  //-------------------------------------------------------------

  getBannerResult() {
    let b = "";
    if (!this.testResult.passed) {
      for (const er of this.testResult.error) {
        b += `   | ${er}\r\n`;
      }

      if ( typeof this.logFileName != "undefined" ){
        b += "   | logFile=" + this.logFileName + "\r\n";
      }

      b += "  // [FAIL] ";
    } else {
      b += "  // [PASS] ";
    }

    return b + `ContentLength=${this.testResult.bytes}; networkTime=${this.testResult.networkTimeMs}ms; testTime=${this.testResult.testTimeMs}ms\r\n`;
  }
};