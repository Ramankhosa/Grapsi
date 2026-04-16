import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

async function test() {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    
    const pkgDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const workerPath = path.join(pkgDir, 'legacy', 'build', 'pdf.worker.mjs');
    
    if (fs.existsSync(workerPath)) {
      pdfjs.GlobalWorkerOptions.workerSrc = `file:///${workerPath.replace(/\\/g, '/')}`;
      console.log('Worker path set:', pdfjs.GlobalWorkerOptions.workerSrc);
    }

    // Find any PDF file under local-pdfs
    const localPdfsDir = path.join(process.cwd(), 'local-pdfs');
    if (!fs.existsSync(localPdfsDir)) {
      console.log('No local-pdfs directory found. Looking for any PDF...');
      // Try to find one from uploads
      const uploadsDir = path.join(process.cwd(), 'uploads');
      if (fs.existsSync(uploadsDir)) {
        const files = fs.readdirSync(uploadsDir, { recursive: true }).filter(f => String(f).endsWith('.pdf'));
        if (files.length > 0) {
          const testFile = path.join(uploadsDir, String(files[0]));
          console.log('Testing with:', testFile);
          await parsePdf(pdfjs, testFile);
          return;
        }
      }
      console.log('No PDF files found to test with');
      return;
    }

    const pdfs = fs.readdirSync(localPdfsDir).filter(f => f.endsWith('.pdf'));
    if (pdfs.length === 0) {
      console.log('No PDFs in local-pdfs');
      return;
    }

    const testFile = path.join(localPdfsDir, pdfs[0]);
    console.log('Testing with:', testFile);
    await parsePdf(pdfjs, testFile);
  } catch (e) {
    console.error('TOP-LEVEL ERROR:', e.message);
    console.error(e.stack);
  }
}

async function parsePdf(pdfjs, filePath) {
  try {
    const data = new Uint8Array(fs.readFileSync(filePath));
    console.log('File read, size:', data.length);

    const loadingTask = pdfjs.getDocument({
      data,
      useSystemFonts: true,
      disableFontFace: true,
      isEvalSupported: false,
    });
    
    console.log('Loading task created');
    const doc = await loadingTask.promise;
    console.log('Document loaded, pages:', doc.numPages);

    const page = await doc.getPage(1);
    console.log('Page 1 loaded');
    
    const content = await page.getTextContent();
    console.log('Text content extracted, items:', content.items.length);
    
    const viewport = page.getViewport({ scale: 1.0 });
    console.log('Viewport:', viewport.width, 'x', viewport.height);
    
    console.log('SUCCESS - PDF parsing works!');
  } catch (e) {
    console.error('PARSE ERROR:', e.message);
    console.error(e.stack);
  }
}

test();
