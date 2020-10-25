import fs from "fs-extra";
import * as path from "path";
import { getOptions } from "loader-utils";
import { validate } from "schema-utils";
import * as Tsickle from "tsickle";
import ts from "typescript";
import { EOL } from "os";
import { fixCode, fixExtern } from "./fix-output";
import { jsToTS, tsToJS } from "./path-utils";
import { JSONSchema7 } from "json-schema";
// import { TcpSocketConnectOpts } from "net";

const LOADER_NAME = "tsickle-loader";
const DEFAULT_EXTERN_DIR = "dist/externs";
const EXTERNS_FILE_NAME = "externs.js";
const DEFAULT_CONFIG_FILE = "tsconfig.json";

const optionsSchema: JSONSchema7 = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties: {
    tsconfig: {
      type: "string",
    },
    externDir: {
      type: "string",
    },
  },
};

interface OptionsFromSchema {
  externDir: string;
  tsconfig: string;
  externFile: string;
  compilerConfig: ReturnType<typeof ts.parseJsonConfigFileContent>;
}

const setup = (loaderCTX: LoaderCTX): OptionsFromSchema => {
  const options: any = getOptions(loaderCTX);

  validate(optionsSchema, options, { name: LOADER_NAME });

  options as OptionsFromSchema;

  const externDir = options.externDir ?? DEFAULT_EXTERN_DIR;
  const externFile = path.resolve(externDir, EXTERNS_FILE_NAME);

  fs.ensureDirSync(externDir);

  const tsconfig = options.tsconfig ?? DEFAULT_CONFIG_FILE;

  const compilerConfigFile = ts.readConfigFile(
    tsconfig,
    (configPath: string) => {
      return fs.readFileSync(configPath, "utf-8");
    }
  );

  const compilerConfig = ts.parseJsonConfigFileContent(
    compilerConfigFile.config,
    ts.sys,
    ".",
    {},
    tsconfig
  );

  return {
    tsconfig,
    externDir,
    externFile,
    compilerConfig,
  };
};

const handleDiagnostics = (
  ctx: LoaderCTX,
  diagnostics: ReadonlyArray<ts.Diagnostic>,
  diagnosticHost: ts.FormatDiagnosticsHost,
  type: "error" | "warning"
): void => {
  const formatted = ts.formatDiagnosticsWithColorAndContext(
    diagnostics,
    diagnosticHost
  );

  if (type === "error") {
    ctx.emitError(new Error(formatted));
  } else {
    ctx.emitWarning(formatted);
  }
};

interface LoaderCTX {
  resourcePath: string;
  emitError(error: Error): void;
  emitWarning(warning: string): void;
}

type Loader = (this: LoaderCTX, source: string | Buffer) => void;

const tsickleLoader: Loader = function (source) {
  const {
    compilerConfig: { options },
    externFile,
  } = setup(this);

  // normalize the path to unix-style
  const sourceFileName = this.resourcePath.replace(/\\/g, "/");
  const compilerHost = ts.createCompilerHost(options);
  const program = ts.createProgram([sourceFileName], options, compilerHost);
  const diagnostics = ts.getPreEmitDiagnostics(program);

  const diagnosticsHost: ts.FormatDiagnosticsHost = {
    getNewLine: () => EOL,
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => path.dirname(sourceFileName),
  };

  if (diagnostics.length > 0) {
    handleDiagnostics(this, diagnostics, diagnosticsHost, "error");
    return;
  }

  const tsickleHost: Tsickle.TsickleHost = {
    shouldSkipTsickleProcessing: (filename: string) =>
      sourceFileName !== filename,
    shouldIgnoreWarningsForPath: () => false,
    pathToModuleName: (name: string) => name,
    fileNameToModuleId: (name: string) => name,
    options: {}, // TODO: set possible options here
    es5Mode: true,
    moduleResolutionHost: compilerHost,
    googmodule: false,
    transformDecorators: true,
    transformTypesToClosure: true,
    typeBlackListPaths: new Set(),
    untyped: false,
    logWarning: (warning) =>
      handleDiagnostics(this, [warning], diagnosticsHost, "warning"),
  };

  const jsFiles = new Map<string, string>();

  const writeFile = (path: string, contents: string) =>
    jsFiles.set(path, contents);

  const output = Tsickle.emit(program, tsickleHost, writeFile);

  const sourceFileAsJs = tsToJS(sourceFileName);
  for (const [path, source] of jsFiles) {
    if (sourceFileAsJs.indexOf(path) === -1) {
      continue;
    }

    const tsPathName = jsToTS(path);
    const extern = output.externs[tsPathName];
    if (extern != null) {
      // console.info(`appending extern for ${path} to (${externFile}) ::\n${extern}\n`);
      fs.appendFileSync(externFile, fixExtern(extern));
    }

    const fixed = fixCode(source);
    // console.info("FIXED CODE:: \n", fixed);
    return fixed;
  }

  this.emitError(
    Error(`missing compiled result for source file: ${sourceFileName}`)
  );
};

export default tsickleLoader;
