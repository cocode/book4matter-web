# Book4matter Web

Book4matter turns Markdown, and plain-text manuscripts into formatted books in
your browser. Files stay on your device; there is no server-side conversion.
The web app is available at [app.book4matter.com](https://app.book4matter.com/), with
a command line version available website at [book4matter.com](https://book4matter.com/), and [github project](https://github.com/cocode/Book4matter)

Add files with the file picker, select a folder, or drag files and folders into
the drop area. Add as many batches as you need: chapters first, then settings,
images, or fonts. New files with the same relative path replace earlier copies.
Review the list to remove individual files or clear it to start another book.

If your project has more than one directory, it's best if you upload the whole project
folder. This keeps relative paths, like ../images/picture.jpg, pointing to the right
place. 

Note that no files leave your computer. All processing is done in locally, in your web browser.

If a referenced image, cover, or included file is missing, a message beside the
build buttons names it and offers **Add a folder** and **Add files**. Adding the
whole book folder preserves relative paths. Duplicate filenames and web-hosted
images get specific guidance; technical details remain available separately.
Books with numbered exercises or figures also need their numbering definitions
from the original `book_metadata.yaml`. The title/author form supplies basic
book details; missing numbering settings are explained beside the build buttons.
PDF builds also name missing font families beside the build buttons. Add the
referenced `.ttf` or `.otf` files (including bold and italic styles), or add the
whole book folder including its fonts, then retry. Fonts installed on your
computer are not automatically available to the browser's PDF engine.

- With a `chapters/` folder, only its `.docx`, `.md`, and `.txt` files are chapters,
  including files in its subfolders. Text files elsewhere are ignored.
- Without `chapters/`, all uploaded `.docx`, `.md`, and `.txt` files are chapters.
- Chapters use natural filename order (2 before 10). The uploaded files determine
  the chapter set; a CLI `chapters:` list in YAML does not exclude uploaded
  chapters or require files you did not add.
- `book_metadata.yaml` and `book_style.yaml` are optional and may be anywhere in
  the upload. Metadata overrides style settings when the same key appears in
  both. More than one copy of either settings file produces an error.
- Keep relative image paths when adding folders. For loose files, a reference
  such as `media/cover.png` can also resolve to a uniquely named `cover.png`.
  Ambiguous or missing image references produce an error. Upload fonts anywhere
  and select their family names in the YAML settings.

Word files are imported with headings, text formatting, and embedded images.
They can be mixed with Markdown and text chapters in filename order. Word page
layout is replaced by the book’s styling. Legacy `.doc` files are not supported;
save them as `.docx` first. Not all features of the word layout will be preserved.

Choose 
**Print PDF** for the print interior
**Screen PDF** for clickable links and an optional cover
**HTML** for a standalone browser document
**EPUB** for an e-reader. 

Plain `.txt` content is kept literal in each output; Markdown
formatting applies only to `.md` chapters. 

PDF output has an in-page preview;
HTML and EPUB are downloads. An optional `book_style.css` is embedded in HTML.

See https://book4matter.com/examples/docs/book4matter.html for a full manual,
which is build with book4matter.

See [README-DEV.md](README-DEV.md) for build instructions.
