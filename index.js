/*
 * This file is just a small hack to allow CommonJS require()-ing
 * the default export as:
 *
 * const createSubscriber = require("pg-listen")
 */

const moduleExports = require("./dist/index")
const createPosgresSubscriber = moduleExports.default

module.exports = Object.assign(createPosgresSubscriber, moduleExports)
