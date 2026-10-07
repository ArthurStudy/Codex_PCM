/* Small, dependency-free OOXML workbook writer for the orders export. */
globalThis.PCMExcel = (() => {
  const encoder = new TextEncoder();
  const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  function zip(files) {
    const parts = [], directory = [];
    let offset = 0;
    const header = size => new DataView(new ArrayBuffer(size));
    for (const [path, content] of Object.entries(files)) {
      const name = encoder.encode(path), data = encoder.encode(declaration + content);
      let crc = 0xffffffff;
      for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
      crc = (crc ^ 0xffffffff) >>> 0;
      const local = header(30);
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(12, 33, true);
      local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true);
      parts.push(new Uint8Array(local.buffer), name, data);
      const central = header(46);
      central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true); central.setUint16(14, 33, true);
      central.setUint32(16, crc, true); central.setUint32(20, data.length, true); central.setUint32(24, data.length, true); central.setUint16(28, name.length, true); central.setUint32(42, offset, true);
      directory.push(new Uint8Array(central.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const size = directory.reduce((sum, part) => sum + part.length, 0), end = header(22);
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, Object.keys(files).length, true); end.setUint16(10, Object.keys(files).length, true); end.setUint32(12, size, true); end.setUint32(16, offset, true);
    const result = new Uint8Array(offset + size + 22); let pos = 0;
    for (const part of [...parts, ...directory, new Uint8Array(end.buffer)]) { result.set(part, pos); pos += part.length; }
    return result;
  }
  function build(rows, options = {}) {
    if (!rows.length || rows.length > 1048576) throw new Error('Quantidade de linhas inválida para Excel.');
    const widths = [15, 56, 20, 26, 22, 14, 23, 18, 16, 16, 16, 16, 18, 18, 22].slice(0, rows[0].length);
    const exportWithMachineName = rows[0].length >= 15;
    const dateStart = exportWithMachineName ? 9 : 8;
    const dateEnd = exportWithMachineName ? 11 : 10;
    const numberStart = exportWithMachineName ? 12 : 11;
    const currencyColumn = exportWithMachineName ? 14 : 13;
    const sheetRows = rows.map((row, r) => {
      const cells = row.map((value, c) => {
        const ref = String.fromCharCode(65 + c) + (r + 1);
        let style = r === 0 ? 1 : (r % 2 ? 2 : 3), numeric;
        if (r > 0 && c >= dateStart && c <= dateEnd && /^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) {
          numeric = (Date.parse(value + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000;
          style = r % 2 ? 4 : 5;
        } else if (r > 0 && c >= numberStart && value !== '' && value != null && Number.isFinite(Number(value))) {
          numeric = Number(value); style = c === currencyColumn ? (r % 2 ? 8 : 9) : (r % 2 ? 6 : 7);
        }
        return Number.isFinite(numeric) ? `<c r="${ref}" s="${style}"><v>${numeric}</v></c>` : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
      }).join('');
      return `<row r="${r + 1}"${r === 0 ? ' ht="32" customHeight="1"' : ''}>${cells}</row>`;
    }).join('');
    const colName = n => { let name=''; for (; n; n=Math.floor((n-1)/26)) name=String.fromCharCode(65+(n-1)%26)+name; return name; };
    const validations = Object.entries(options.validations || {}).filter(([,values]) => Array.isArray(values) && values.length).map(([column, values], index) => {
      const col = Number(column) + 1, listCol = index + 1, list = values.map((value, row) => `<c r="${colName(listCol)}${row + 2}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('');
      return { col, ref: `${colName(col)}2:${colName(col)}1000`, range: `$${colName(listCol)}$2:$${colName(listCol)}$${values.length + 1}`, list: values, listCol };
    });
    const listsRows = Array.from({length: Math.max(0, ...validations.map(v => v.list.length))}, (_, row) => `<row r="${row + 2}">${validations.map(v => v.list[row] == null ? '' : `<c r="${colName(v.listCol)}${row + 2}" t="inlineStr"><is><t xml:space="preserve">${xml(v.list[row])}</t></is></c>`).join('')}</row>`).join('');
    const validationXml = validations.length ? `<dataValidations count="${validations.length}">${validations.map(v => `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" promptTitle="Como preencher" prompt="Escolha uma opção da lista suspensa." errorTitle="Valor inválido" error="Escolha uma opção da lista." sqref="${v.ref}"><formula1>Listas!${v.range}</formula1></dataValidation>`).join('')}</dataValidations>` : '';
    const formats = [0, 0, 0, 0, 164, 164, 165, 165, 166, 166];
    const styles = formats.map((format, i) => `<xf numFmtId="${format}" fontId="${i === 1 ? 1 : 0}" fillId="${i === 1 ? 2 : i > 1 && i % 2 ? 3 : 0}" borderId="0" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment vertical="top" wrapText="1"/></xf>`).join('');
    return zip({
      '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml': `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="Ordens de serviço" sheetId="1" r:id="rId1"/>${validations.length?'<sheet name="Listas" sheetId="2" state="hidden" r:id="rId3"/>':''}</sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${validations.length?'<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>':''}</Relationships>`,
      'xl/styles.xml': `<styleSheet xmlns="${ns}"><numFmts count="3"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="0.00"/><numFmt numFmtId="166" formatCode="&quot;R$&quot; #,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF007F79"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F6F6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="10">${styles}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
      'xl/worksheets/sheet1.xml': `<worksheet xmlns="${ns}"><dimension ref="A1:${colName(rows[0].length)}${rows.length}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="C2" sqref="C2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="30"/><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:${colName(rows[0].length)}${rows.length}"/>${validationXml}<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9"/></worksheet>`,
      ...(validations.length ? {'xl/worksheets/sheet2.xml': `<worksheet xmlns="${ns}"><sheetData><row r="1">${validations.map((v,index) => `<c r="${colName(index+1)}1" t="inlineStr"><is><t>${xml(Object.keys(options.validations)[index])}</t></is></c>`).join('')}</row>${listsRows}</sheetData></worksheet>`} : {})
    });
  }
  return {build};
})();
