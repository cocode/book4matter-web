// Translate only the pinned publishing engine's flags into Pandoc WASM options.
// Keep paths intact: different directories may contain the same filename.
export function pandocCommand(argv) {
  const options = { 'input-files': [], filters: ['browser-images.lua'], css: [], metadata: {} };
  let output;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-f') options.from = argv[++i];
    else if (arg === '-t') options.to = argv[++i];
    else if (arg === '-o') output = argv[++i];
    else if (arg === '--wrap=preserve') options.wrap = 'preserve';
    else if (arg === '--toc') options['table-of-contents'] = true;
    else if (['--standalone', '--section-divs', '--embed-resources'].includes(arg)) options[arg.slice(2)] = true;
    else if (arg.startsWith('--toc-depth=')) options['toc-depth'] = Number(arg.split('=')[1]);
    else if (arg.startsWith('--lua-filter=')) options.filters.push(arg.slice('--lua-filter='.length).split('/').at(-1));
    else if (arg.startsWith('--css=')) options.css.push(arg.slice('--css='.length));
    else if (arg.startsWith('--metadata-file=')) options['metadata-files'] = [arg.slice('--metadata-file='.length)];
    else if (arg.startsWith('--epub-cover-image=')) options['epub-cover-image'] = arg.slice('--epub-cover-image='.length);
    else if (arg.startsWith('--resource-path=')) options['resource-path'] = arg.slice('--resource-path='.length).split(':');
    else if (arg === '--metadata') {
      const value = argv[++i];
      const split = value.indexOf('=');
      if (split < 1) throw new Error(`Unsupported metadata: ${value}`);
      options.metadata[value.slice(0, split)] = value.slice(split + 1);
    } else if (arg.startsWith('-')) throw new Error(`Unsupported Pandoc flag: ${arg}`);
    else options['input-files'].push(arg);
  }
  if (options.from !== 'markdown' || !['typst', 'html5', 'epub3'].includes(options.to) || !output) {
    throw new Error(`Unsupported Pandoc command: ${argv.join(' ')}`);
  }
  // Binary EPUB output must go to a file; decoding stdout would corrupt it.
  options['output-file'] = `result.${options.to === 'epub3' ? 'epub' : options.to === 'typst' ? 'typ' : 'html'}`;
  return { options, output };
}
