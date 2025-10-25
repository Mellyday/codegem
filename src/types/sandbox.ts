export type AstSupport = "babel" | "tree-sitter" | "none";

export type SandboxRoute = {
  fileName: string;
  routePath: string;
  label: string;
  astSupport: AstSupport;
};
