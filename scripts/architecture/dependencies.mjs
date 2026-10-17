import ts from 'typescript';

export function importSpecifiers(source, fileName = 'module.ts') {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const imports = new Set();
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      imports.add(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      imports.add(node.arguments[0].text);
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    )
      imports.add(node.argument.literal.text);
    ts.forEachChild(node, visit);
  }
  visit(file);
  return [...imports];
}

/** Every directed edge participating in a cycle, including cycles longer than two modules. */
export function cycleEdges(graph) {
  const result = [];
  function reaches(start, target, visited = new Set()) {
    if (start === target) return true;
    if (visited.has(start)) return false;
    visited.add(start);
    return [...(graph.get(start) ?? [])].some((next) => reaches(next, target, visited));
  }
  for (const [owner, dependencies] of graph) {
    for (const dependency of dependencies) {
      if (reaches(dependency, owner)) result.push(`${owner} -> ${dependency}`);
    }
  }
  return result.sort();
}

export function cycleBaselineErrors(actual, baseline) {
  const current = new Set(actual);
  const allowed = new Set(Object.keys(baseline));
  return [
    ...actual.filter((edge) => !allowed.has(edge)).map((edge) => `New cyclic dependency: ${edge}`),
    ...[...allowed]
      .filter((edge) => !current.has(edge))
      .map((edge) => `Remove resolved cycle from the baseline: ${edge}`),
  ];
}

/** Calls executed during module evaluation, excluding deferred function bodies. */
export function topLevelCalls(source, fileName = 'module.ts') {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const calls = [];
  function visit(node) {
    if (ts.isFunctionLike(node)) return;
    if (
      (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
      ts.isIdentifier(node.expression)
    ) {
      calls.push(node.expression.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return calls;
}
