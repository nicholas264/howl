// Pin emitted asset references to their deployment. Document navigations stay fresh.
export function skewProtectionPlugin({ enabled, deploymentId } = {}) {
  if (!enabled || !deploymentId) return { name: 'howl-skew-disabled' };
  if (!/^dpl_[a-zA-Z0-9]+$/.test(deploymentId)) throw new Error('Invalid deployment ID');
  const pin = value => `${value}?dpl=${deploymentId}`;
  return {
    name: 'howl-skew-protection', enforce: 'post', apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const files = new Set(Object.keys(bundle));
        for (const output of Object.values(bundle)) {
          if (output.type !== 'chunk') continue;
          const directory = output.fileName.slice(0, output.fileName.lastIndexOf('/') + 1);
          const edits = [];
          const stack = [this.parse(output.code)];
          while (stack.length) {
            const node = stack.pop();
            if (!node || typeof node !== 'object') continue;
            // Vite identifies lazy stylesheets by their extension. Deployment
            // queries must not make the preload helper treat CSS as a module.
            if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
              && node.callee.property.name === 'endsWith' && node.arguments.length === 1
              && node.arguments[0].value === '.css') {
              const receiver = node.callee.object;
              edits.push({ start: receiver.end, end: receiver.end, text: '.split("?")[0]' });
            }
            if (node.type === 'Literal' && typeof node.value === 'string') {
              const value = node.value;
              const resolved = value.startsWith('./') ? directory + value.slice(2) : value.replace(/^\//, '');
              if (files.has(resolved)) edits.push({ start: node.start, end: node.end, text: JSON.stringify(pin(value)) });
            }
            for (const value of Object.values(node)) {
              if (Array.isArray(value)) stack.push(...value);
              else if (value && typeof value === 'object') stack.push(value);
            }
          }
          for (const edit of edits.sort((a,b) => b.start-a.start)) {
            output.code = output.code.slice(0,edit.start) + edit.text + output.code.slice(edit.end);
          }
        }
      },
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace(/((?:src|href)=["'])(\/assets\/[^"'?]+)(["'])/g, (_all, before, url, after) => before + pin(url) + after);
      },
    },
  };
}
