declare module "loader-utils" {
  export interface OptionObject {
    [key: string]: null | false | true | string;
  }

  export type Readonly<T> = {
    readonly [P in keyof T]: T[P];
  };

  /**
   * Recommended way to retrieve the options of a loader invocation
   * {@link https://github.com/webpack/loader-utils#getoptions}
   */
  export function getOptions(loaderContext: any): Readonly<OptionObject>;
}
