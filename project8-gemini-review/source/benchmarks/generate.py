"""Generate synthetic supplier bill/base pairs and hand-specified expected outcomes.

Python 3 standard library only. Outputs contain no real commercial records.
"""
from __future__ import annotations

import csv
import io
import json
from pathlib import Path
import zipfile
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent
HEAD = ["supplier", "shipment", "charge", "currency", "unit", "amount"]
ZH = ["供应商", "运单号", "费用名", "币种", "计费单位", "行金额"]


def fee(charge="DOC", amount="100", currency="CNY", unit="shipment", shipment="0017", supplier="DEMO-FWD"):
    return [supplier, shipment, charge, currency, unit, amount]


# Expected statuses and signed differences (minor units) are specified by hand.
# A null delta means the item needs review. Monetary outcomes are never guessed.
CASES = [
    ("普通相符", "csv", "csv", [fee()], [fee()], [("match",0)]),
    ("明确多收", "xlsx", "csv", [fee(amount="52.45")], [fee(amount="40")], [("over",1245)]),
    ("文字 PDF 低于采购价", "pdf", "xlsx", [fee(amount="37.41")], [fee(amount="40")], [("under",-259)]),
    ("采购依据为文字 PDF", "csv", "pdf", [fee(currency="AUD")], [fee(currency="AUD")], [("match",0)]),
    ("供应商账单双行同键", "xlsx", "xlsx", [fee(),fee()], [fee()], [("duplicate",None),("duplicate",None)]),
    ("采购方同键两种价格", "csv", "xlsx", [fee()], [fee(),fee(amount="103")], [("duplicate",None)]),
    ("币种不同且数额相同", "xlsx", "csv", [fee(currency="USD")], [fee()], [("mismatch",None)]),
    ("计重单位不同", "csv", "pdf", [fee(unit="kg")], [fee(unit="lb")], [("mismatch",None)]),
    ("两方各有独有项目", "pdf", "pdf", [fee("LIFT")], [fee("BOX")], [("missing",None),("unbilled",None)]),
    ("三项乱序与双向差额", "csv", "csv", [fee("DOC","14"),fee("HAND","13"),fee("STOR","14")],
     [fee("STOR","10"),fee("DOC","15.5"),fee("HAND","13")], [("under",-150),("match",0),("over",400)]),
    ("明确免收零金额", "csv", "xlsx", [fee(amount="0")], [fee(amount="0")], [("match",0)]),
    ("负数贷项", "xlsx", "pdf", [fee(amount="-24")], [fee(amount="-10")], [("under",-1400)]),
    ("账单缺金额", "csv", "xlsx", [fee(amount="")], [fee()], [("invalid",None),("pending",None)]),
    ("可选中文字但无表头的 PDF", "pdf", "csv", [fee()], [fee()], []),
    ("缺费用名表头的采购 Excel", "xlsx", "xlsx", [fee()], [fee()], []),
    ("文字 PDF 千位分隔和小数", "pdf", "csv", [fee(amount="1,234.50")], [fee(amount="1230")], [("over",450)]),
    ("中文 Excel 表头和前导零运单", "xlsx", "xlsx", [fee(shipment="000019")], [fee(shipment="000019")], [("match",0)]),
    ("单位同义词和金额前导零", "csv", "csv", [fee(amount="0007.20",unit="KG")], [fee(amount="7.2",unit="公斤")], [("match",0)]),
    ("金额精度超出两位", "csv", "xlsx", [fee(amount="101.235")], [fee()], [("invalid",None),("pending",None)]),
    ("多运单币种歧义与真实可比行并列", "xlsx", "pdf",
     [fee(currency="CNY",shipment="P01"),fee(amount="34",shipment="P02")],
     [fee(currency="EUR",shipment="P01"),fee(amount="30",shipment="P02")], [("mismatch",None),("over",400)]),
]


def deterministic_zip(parts):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for p, data in sorted(parts.items()):
            info=zipfile.ZipInfo(p, (2000,1,1,0,0,0))
            info.compress_type=zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    return buffer.getvalue()


def xlsx(headers, values):
    main="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    package="http://schemas.openxmlformats.org/package/2006/relationships"
    rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    # Literal inline strings keep significant leading zeros in ID columns.
    rows=[]
    for n,row in enumerate([headers]+values,1):
        cells="".join(f'<c r="{chr(65+j)}{n}" t="inlineStr"><is><t xml:space="preserve">{escape(val)}</t></is></c>' for j,val in enumerate(row))
        rows.append(f'<row r="{n}">{cells}</row>')
    parts={
      "[Content_Types].xml":'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
      "_rels/.rels":f'<Relationships xmlns="{package}"><Relationship Id="rId1" Type="{rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      "xl/workbook.xml":f'<workbook xmlns="{main}" xmlns:r="{rel}"><sheets><sheet name="Synthetic" sheetId="1" r:id="rId1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels":f'<Relationships xmlns="{package}"><Relationship Id="rId1" Type="{rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      "xl/worksheets/sheet1.xml":f'<worksheet xmlns="{main}"><sheetData>{"".join(rows)}</sheetData></worksheet>',
    }
    return deterministic_zip(parts)


def as_pdf(headers,values):
    # Deliberately controlled, one text object per table cell; not OCR.
    columns=(38,145,232,315,393,484)
    stream=[]
    for i,row in enumerate([headers]+values):
        for x,val in zip(columns,row):
            val=val.replace("\\","\\\\").replace("(","\\(").replace(")","\\)")
            stream.append(f"BT /F1 10 Tf 1 0 0 1 {x} {775-i*20} Tm ({val}) Tj ET")
    payload=("\n".join(stream)+"\n").encode("ascii")
    objs=[b"<< /Type /Catalog /Pages 2 0 R >>",b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
      b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 820] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      b"<< /Length "+str(len(payload)).encode()+b" >>\nstream\n"+payload+b"endstream"]
    out=bytearray(b"%PDF-1.4\n")
    starts=[0]
    for i,obj in enumerate(objs,1):
        starts.append(len(out));out.extend(f"{i} 0 obj\n".encode()+obj+b"\nendobj\n")
    at=len(out);out.extend(f"xref\n0 {len(objs)+1}\n0000000000 65535 f \n".encode())
    for n in starts[1:]:
        out.extend(f"{n:010d} 00000 n \n".encode())
    out.extend(f"trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{at}\n%%EOF\n".encode())
    return bytes(out)


def to_file(ext,header,rows):
    if ext=="pdf":return as_pdf(header,rows)
    if ext=="xlsx":return xlsx(header,rows)
    output=io.StringIO(newline="")
    writer=csv.writer(output)
    writer.writerows([header]+rows)
    return output.getvalue().encode("utf-8-sig")


def main():
    out=HERE/"pairs";out.mkdir(exist_ok=True)
    keyrows=[]
    for idx,(title,inv_ext,base_ext,inv,base,expected) in enumerate(CASES,1):
        case_id=f"SIM{idx:02d}";folder=out/case_id;folder.mkdir(exist_ok=True)
        files={}
        blocked=[]
        for side,extension,rows in [("invoice",inv_ext,inv),("baseline",base_ext,base)]:
            header=ZH.copy() if idx==17 else HEAD.copy()
            if (idx==14 and side=="invoice") or (idx==15 and side=="baseline"):
                header[2]="unmapped heading"
                blocked.append(side)
            name=f"{case_id}_{side}.{extension}"
            (folder/name).write_bytes(to_file(extension,header,rows))
            files[side]=f"pairs/{case_id}/{name}"
        keyrows.append({"id":case_id,"scenario":title,"files":files,
          "cells":{"invoice":inv,"baseline":base},"unreadableSides":blocked,
          "expectedAfterSourceCheck":expected,"requiresPdfConfirmation":inv_ext=="pdf" or base_ext=="pdf"})
    (HERE/"answer-key.json").write_text(json.dumps(keyrows,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(f"{len(keyrows)} synthetic matched input pairs written, two files per pair.")


if __name__=="__main__":
    main()
