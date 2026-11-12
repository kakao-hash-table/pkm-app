// 공모전 신청서 .hwp(HWP 5) 읽기·채우기 — Java 라이브러리 hwplib로 표의 빈칸을 찾아 값을 넣고, 원본 서식은 그대로 .hwp로 저장한다.
//   readForm(file) → { text, tables, fields } · fillForm(src, out, { 라벨: 값 }) → { filled, missing, unknown }
//   readBlocks(file) · editBlocks(src, part, ops) — docs.mjs(.hwp·.hwpx 공통 블록 모델)가 쓰는 낮은 층
//   ensureLib() — hwplib jar를 처음 쓸 때 Maven Central에서 받아 sha256을 검사하고, 도우미 Java 코드를 컴파일해 둔다
// 저장: <PKM_HOME 또는 ~/.pkm-app>/lib/ (꾸러미에는 jar·.java를 넣을 수 없어서)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

const JAR = { name: 'hwplib-1.1.11.jar', url: 'https://repo1.maven.org/maven2/kr/dogfoot/hwplib/1.1.11/hwplib-1.1.11.jar',
  sha256: 'fd464ff56eec7f58d463f7533da7501d4bb8261a225c20b7b19bed9e137f7e04' };   // 의존 jar 없음(pom에 dependencies 없음)
const NOT_HWP = '이 양식은 .hwp가 아니라 직접 채워야 해요';
const NO_JAVA = '이 컴퓨터에 Java가 없어요. Java 17 이상을 설치해 주세요';
const fail = msg => { throw Object.assign(new Error(msg), { user: true }); };
const blank = v => v == null || !String(v).trim();
const libDir = () => path.join(process.env.PKM_HOME || path.join(os.homedir(), '.pkm-app'), 'lib');
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const run = (bin, args, opt = {}) => new Promise((ok, no) => execFile(bin, args, { encoding: 'utf8', maxBuffer: 16 << 20, ...opt }, (e, out, err) => e ? no(Object.assign(e, { out, err })) : ok({ out, err })));

// 도우미: read <hwp> <out.json> · fill <hwp> <out.hwp> <cells.tsv>(표 번호·행·열·문단(-1은 칸 전체)·base64 값). 결과는 stdout에 JSON 한 줄
//   doc <hwp> <out.json>(블록 모델) · edit <hwp> <out.hwp> <ops.tsv>(명령·블록·행·열·문단·base64 글) — docs.mjs가 쓴다
const JAVA_SRC = String.raw`
import java.io.*;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import kr.dogfoot.hwplib.object.HWPFile;
import kr.dogfoot.hwplib.object.docinfo.bindata.*;
import kr.dogfoot.hwplib.object.docinfo.borderfill.fillinfo.*;
import kr.dogfoot.hwplib.object.bodytext.control.ctrlheader.CtrlHeaderGso;
import kr.dogfoot.hwplib.object.bodytext.control.ctrlheader.gso.*;
import kr.dogfoot.hwplib.object.bodytext.control.gso.ControlRectangle;
import kr.dogfoot.hwplib.object.bodytext.control.gso.GsoControlType;
import kr.dogfoot.hwplib.object.bodytext.control.gso.shapecomponent.ShapeComponentNormal;
import kr.dogfoot.hwplib.object.bodytext.control.gso.shapecomponent.lineinfo.*;
import kr.dogfoot.hwplib.object.bodytext.control.gso.shapecomponent.shadowinfo.ShadowType;
import kr.dogfoot.hwplib.object.bodytext.control.gso.shapecomponenteach.ShapeComponentRectangle;
import kr.dogfoot.hwplib.object.bodytext.Section;
import kr.dogfoot.hwplib.object.bodytext.ParagraphListInterface;
import kr.dogfoot.hwplib.object.bodytext.paragraph.Paragraph;
import kr.dogfoot.hwplib.object.bodytext.paragraph.ParagraphList;
import kr.dogfoot.hwplib.object.bodytext.paragraph.charshape.CharPositionShapeIdPair;
import kr.dogfoot.hwplib.object.bodytext.paragraph.charshape.ParaCharShape;
import kr.dogfoot.hwplib.object.bodytext.paragraph.header.DivideSort;
import kr.dogfoot.hwplib.object.bodytext.paragraph.text.HWPChar;
import kr.dogfoot.hwplib.object.bodytext.paragraph.text.HWPCharType;
import kr.dogfoot.hwplib.object.bodytext.control.Control;
import kr.dogfoot.hwplib.object.bodytext.control.ControlTable;
import kr.dogfoot.hwplib.object.bodytext.control.ControlType;
import kr.dogfoot.hwplib.object.bodytext.control.table.Cell;
import kr.dogfoot.hwplib.object.bodytext.control.table.ListHeaderForCell;
import kr.dogfoot.hwplib.object.bodytext.control.table.Row;
import kr.dogfoot.hwplib.reader.HWPReader;
import kr.dogfoot.hwplib.writer.HWPWriter;

public class HwpForm {
  static List<ControlTable> tables = new ArrayList<>();
  static StringBuilder text = new StringBuilder();

  public static void main(String[] a) throws Exception {
    PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8");
    String r;
    try { r = run(a); }
    catch (Throwable e) {
      String m = String.valueOf(e.getMessage()).toLowerCase();
      r = "{\"ok\":false,\"error\":\"" + (m.contains("password") ? "password" : "broken") + "\",\"detail\":" + q(String.valueOf(e)) + "}";
    }
    out.println(r);
  }

  static String run(String[] a) throws Exception {
    HWPFile f = HWPReader.fromFile(a[1]);
    boolean dist = f.getFileHeader().isDistribution();
    if (a[0].equals("doc")) {
      Files.write(Paths.get(a[2]), doc(f).getBytes(StandardCharsets.UTF_8));
      return "{\"ok\":true,\"distribution\":" + dist + "}";
    }
    if (a[0].equals("edit")) return dist ? "{\"ok\":false,\"error\":\"distribution\"}" : edit(f, a[2], a[3]);
    for (Section s : f.getBodyText().getSectionList()) walk(s, true);
    if (a[0].equals("read")) {
      StringBuilder b = new StringBuilder("{\"text\":").append(q(text.toString())).append(",\"tables\":[");
      for (int i = 0; i < tables.size(); i++) {
        b.append(i > 0 ? "," : "").append("{\"index\":").append(i).append(",\"rows\":[");
        List<Row> rows = tables.get(i).getRowList();
        for (int j = 0; j < rows.size(); j++) {
          b.append(j > 0 ? "," : "").append("[");
          List<Cell> cells = rows.get(j).getCellList();
          for (int k = 0; k < cells.size(); k++) {
            Cell c = cells.get(k);
            ListHeaderForCell h = c.getListHeader();
            b.append(k > 0 ? "," : "").append("{\"row\":").append(h.getRowIndex()).append(",\"col\":").append(h.getColIndex())
              .append(",\"rowSpan\":").append(h.getRowSpan()).append(",\"colSpan\":").append(h.getColSpan()).append(",\"paras\":[");
            int n = 0;
            for (Paragraph p : c.getParagraphList())
              b.append(n++ > 0 ? "," : "").append("{\"t\":").append(q(line(p))).append(",\"c\":").append(hasControls(p)).append("}");
            b.append("]}");
          }
          b.append("]");
        }
        b.append("]}");
      }
      Files.write(Paths.get(a[2]), b.append("]}").toString().getBytes(StandardCharsets.UTF_8));
      return "{\"ok\":true,\"distribution\":" + dist + "}";
    }
    if (dist) return "{\"ok\":false,\"error\":\"distribution\"}";
    StringBuilder done = new StringBuilder();
    List<String> lines = Files.readAllLines(Paths.get(a[3]), StandardCharsets.UTF_8);
    for (int i = 0; i < lines.size(); i++) {
      String[] p = lines.get(i).split("\t", -1);
      if (p.length < 5) continue;
      int t = Integer.parseInt(p[0]), at = Integer.parseInt(p[3]);
      Cell c = t < tables.size() ? find(tables.get(t), Integer.parseInt(p[1]), Integer.parseInt(p[2])) : null;
      if (c == null || !(at < 0 ? isBlank(c) : isSlot(c, at))) continue;
      put(c, at, new String(Base64.getDecoder().decode(p[4]), StandardCharsets.UTF_8));
      done.append(done.length() > 0 ? "," : "").append(i);
    }
    HWPWriter.toFile(f, a[2]);
    return "{\"ok\":true,\"done\":[" + done + "]}";
  }

  static void walk(ParagraphListInterface list, boolean withText) throws Exception {
    for (Paragraph p : list) {
      if (withText) { String t = p.getNormalString().trim(); if (!t.isEmpty()) text.append(t).append('\n'); }
      if (p.getControlList() == null) continue;
      for (Control c : p.getControlList()) {
        if (c instanceof ControlTable) table((ControlTable) c);
        else for (ParagraphListInterface box : boxes(c)) walk(box, true);
      }
    }
  }

  // 글상자(사각형·타원 등)와 묶음 개체 안의 문단
  static List<ParagraphListInterface> boxes(Object c) {
    List<ParagraphListInterface> r = new ArrayList<>();
    try {
      Method m = c.getClass().getMethod("getTextBox");
      Object tb = m.invoke(c);
      if (tb != null) r.add((ParagraphListInterface) tb.getClass().getMethod("getParagraphList").invoke(tb));
    } catch (Exception e) { }
    try {
      Object kids = c.getClass().getMethod("getChildControlList").invoke(c);
      if (kids != null) for (Object k : (List<?>) kids) r.addAll(boxes(k));
    } catch (Exception e) { }
    return r;
  }

  static void table(ControlTable t) throws Exception {
    tables.add(t);
    text.append("[표 ").append(tables.size()).append("]\n");
    for (Row r : t.getRowList()) {
      StringBuilder b = new StringBuilder();
      for (Cell c : r.getCellList()) b.append(b.length() > 0 ? " | " : "").append(cellText(c));
      text.append(b).append('\n');
    }
    for (Row r : t.getRowList()) for (Cell c : r.getCellList()) walk(c.getParagraphList(), false);
  }

  static String line(Paragraph p) throws Exception { return p.getNormalString().replaceAll("[\\r\\n\\t]+", " ").trim(); }
  static boolean hasControls(Paragraph p) { return p.getControlList() != null && !p.getControlList().isEmpty(); }

  static String cellText(Cell c) throws Exception {
    StringBuilder b = new StringBuilder();
    for (Paragraph p : c.getParagraphList()) { String t = line(p); if (!t.isEmpty()) b.append(b.length() > 0 ? " " : "").append(t); }
    return b.toString();
  }

  static boolean isBlank(Cell c) throws Exception {
    for (Paragraph p : c.getParagraphList()) if (!line(p).isEmpty() || hasControls(p)) return false;
    return true;
  }

  // 밑줄(____)만 있는 문단 = 써 넣을 자리
  static boolean isSlot(Cell c, int at) throws Exception {
    if (at >= c.getParagraphList().getParagraphCount()) return false;
    Paragraph p = c.getParagraphList().getParagraph(at);
    return !hasControls(p) && line(p).matches("[_\\s]*_{4,}[_\\s]*");
  }

  static Cell find(ControlTable t, int row, int col) {
    for (Row r : t.getRowList()) for (Cell c : r.getCellList())
      if (c.getListHeader().getRowIndex() == row && c.getListHeader().getColIndex() == col) return c;
    return null;
  }

  // 칸 전체(at < 0) 또는 밑줄 문단 하나를 값으로 바꾼다. 그 자리 문단·글자 모양을 그대로 쓰고 줄마다 문단 하나.
  // 줄 배치(LineSeg)는 지워 한글이 다시 계산하게 한다
  static void put(Cell c, int at, String value) throws Exception {
    ParagraphList pl = c.getParagraphList();
    Paragraph base = pl.getParagraph(Math.max(at, 0)).clone();
    base.deleteText(); base.deleteLineSeg(); base.deleteRangeTag();
    ParaCharShape cs = base.getCharShape();
    if (cs != null) while (cs.getPositonShapeIdPairList().size() > 1) cs.getPositonShapeIdPairList().remove(cs.getPositonShapeIdPairList().size() - 1);
    if (at < 0) { pl.deleteAllParagraphs(); at = 0; } else pl.deleteParagraph(at);
    for (String line : value.split("\n", -1)) {
      Paragraph p = base.clone();
      if (!line.isEmpty()) { p.createText(); p.getText().addString(line); p.getText().addNewCharControlChar().setCode(13); }
      pl.insertParagraph(at++, p);
    }
    c.getListHeader().setParaCount(pl.getParagraphCount());
  }

  /* ----- 블록 모델(docs.mjs): 맨 위 문단마다 글 블록, 문단에 든 표마다 표 블록 ----- */
  static class Blk {
    Section sec; int s, par; Paragraph p; ControlTable t;
    Blk(Section sec, int s, int par, Paragraph p, ControlTable t) { this.sec = sec; this.s = s; this.par = par; this.p = p; this.t = t; }
  }

  static List<Control> controls(Paragraph p) { return p.getControlList() == null ? new ArrayList<Control>() : p.getControlList(); }

  static List<Blk> blocks(HWPFile f) {
    List<Blk> r = new ArrayList<>();
    int s = 0, par = 0;
    for (Section sec : f.getBodyText().getSectionList()) {
      for (Paragraph p : sec) {
        List<ControlTable> ts = new ArrayList<>();
        for (Control c : controls(p)) if (c instanceof ControlTable) ts.add((ControlTable) c);
        if (ts.isEmpty() || !own(p).trim().isEmpty()) r.add(new Blk(sec, s, par, p, null));
        for (ControlTable t : ts) r.add(new Blk(sec, s, par, p, t));
        par++;
      }
      s++;
    }
    return r;
  }

  // 문단 자체의 글: 탭·묶음 빈칸은 공백, 강제 줄 나눔은 줄바꿈으로, 개체 자리는 뺀다
  static String own(Paragraph p) {
    StringBuilder b = new StringBuilder();
    if (p.getText() == null) return "";
    for (HWPChar c : p.getText().getCharList()) {
      int code = c.getCode();
      if (c.getType() == HWPCharType.Normal) b.append((char) code);
      else if (code == 10) b.append('\n');
      else if (code == 9 || code == 30 || code == 31) b.append(' ');
      else if (code == 24) b.append('-');
    }
    return b.toString();
  }

  // 머리말·각주·글상자처럼 개체 안에 든 문단
  static List<ParagraphListInterface> inner(Control c) {
    List<ParagraphListInterface> r = boxes(c);
    try { r.add((ParagraphListInterface) c.getClass().getMethod("getParagraphList").invoke(c)); } catch (Exception e) { }
    return r;
  }

  // 문단 글 + 그 안 개체(표는 행마다 ' | ')의 글
  static void lines(Paragraph p, boolean withTables, List<String> out) {
    String o = own(p);
    if (!o.trim().isEmpty()) out.add(o);
    for (Control c : controls(p)) {
      if (c instanceof ControlTable) {
        if (!withTables) continue;
        for (Row r : ((ControlTable) c).getRowList()) {
          List<String> cells = new ArrayList<>();
          for (Cell cell : r.getCellList()) {
            List<String> ls = new ArrayList<>();
            for (Paragraph q : cell.getParagraphList()) lines(q, true, ls);
            cells.add(String.join(" ", ls).replaceAll("\\s+", " ").trim());
          }
          if (!String.join("", cells).isEmpty()) out.add(String.join(" | ", cells));
        }
      } else for (ParagraphListInterface box : inner(c)) for (Paragraph q : box) lines(q, true, out);
    }
  }

  static String paraJson(Paragraph p, boolean withTables) {
    boolean lock = !controls(p).isEmpty();
    List<String> ls = new ArrayList<>();
    if (lock) lines(p, withTables, ls);
    return "\"text\":" + q(lock ? String.join("\n", ls) : own(p)) + ",\"lock\":" + lock;
  }

  static String doc(HWPFile f) {
    StringBuilder b = new StringBuilder("{\"blocks\":[");
    int n = 0;
    for (Blk k : blocks(f)) {
      boolean sec = false, obj = false, ctl = false;
      for (Control c : controls(k.p)) {
        ControlType t = c.getType();
        if (t == ControlType.SectionDefine) sec = true;
        else if (t == ControlType.Gso || t == ControlType.Equation || t == ControlType.Form) obj = true;
        else if (t != ControlType.Table) ctl = true;
      }
      b.append(n++ > 0 ? "," : "").append("{\"s\":").append(k.s).append(",\"par\":").append(k.par).append(",\"sec\":").append(sec)
        .append(",\"obj\":").append(obj).append(",\"ctl\":").append(ctl).append(",\"brk\":").append(k.p.getHeader().getDivideSort().isDividePage());
      if (k.t == null) { b.append(",\"kind\":\"para\",").append(paraJson(k.p, false)).append("}"); continue; }
      b.append(",\"kind\":\"table\",\"rows\":[");
      List<Row> rows = k.t.getRowList();
      for (int j = 0; j < rows.size(); j++) {
        b.append(j > 0 ? "," : "").append("[");
        int i = 0;
        for (Cell c : rows.get(j).getCellList()) {
          ListHeaderForCell h = c.getListHeader();
          b.append(i++ > 0 ? "," : "").append("{\"row\":").append(h.getRowIndex()).append(",\"col\":").append(h.getColIndex())
            .append(",\"rowSpan\":").append(h.getRowSpan()).append(",\"colSpan\":").append(h.getColSpan()).append(",\"paras\":[");
          int m = 0;
          for (Paragraph p : c.getParagraphList()) b.append(m++ > 0 ? "," : "").append("{").append(paraJson(p, true)).append("}");
          b.append("]}");
        }
        b.append("]");
      }
      b.append("]}");
    }
    return b.append("]}").toString();
  }

  // 명령: para·cell·cpara(글 바꾸기) · cutt(문단에서 표 빼기) · cutp(문단 지우기) · unbreak(쪽 나눔 풀기)
  //   · image(그림 싣기: 행·열 자리에 가로·세로 HWPUNIT, 문단 자리에 번호, 글 자리에 파일 — 글 속 \u0001번호\u0002 자리에 들어간다).
  // 번호가 밀리지 않게 블록은 고치기 전에 한 번만 센다
  static String edit(HWPFile f, String out, String opsFile) throws Exception {
    List<Blk> bs = blocks(f);
    StringBuilder done = new StringBuilder();
    List<String> ops = Files.readAllLines(Paths.get(opsFile), StandardCharsets.UTF_8);
    for (int i = 0; i < ops.size(); i++) {
      String[] p = ops.get(i).split("\t", -1);
      if (p.length < 6 || Integer.parseInt(p[1]) >= bs.size()) continue;
      Blk k = bs.get(Integer.parseInt(p[1]));
      String v = new String(Base64.getDecoder().decode(p[5]), StandardCharsets.UTF_8);
      Cell c = k.t == null || p[0].equals("image") ? null : find(k.t, Integer.parseInt(p[2]), Integer.parseInt(p[3]));
      if (p[0].equals("image")) images.put(Integer.parseInt(p[4]), new int[] { addImage(f, v), Integer.parseInt(p[2]), Integer.parseInt(p[3]) });
      else if (!apply(p[0], k, c, Integer.parseInt(p[4]), v)) continue;
      done.append(done.length() > 0 ? "," : "").append(i);
    }
    HWPWriter.toFile(f, out);
    return "{\"ok\":true,\"done\":[" + done + "]}";
  }

  static boolean apply(String op, Blk k, Cell c, int at, String v) throws Exception {
    int top = indexOf(k.sec, k.p);
    if (top < 0) return false;
    if (op.equals("unbreak")) { k.p.getHeader().getDivideSort().setDividePage(false); return true; }
    if (op.equals("para")) return k.t == null && swap(k.sec, top, 1, v);
    if (op.equals("cutp")) { if (hasSection(k.p)) return false; k.sec.deleteParagraph(top); return true; }
    if (op.equals("cutt")) return k.t != null && cut(k.p, k.t);
    if (c == null) return false;
    ParagraphList pl = c.getParagraphList();
    boolean ok = op.equals("cell") ? swap(pl, 0, pl.getParagraphCount(), v) : op.equals("cpara") && at >= 0 && at < pl.getParagraphCount() && swap(pl, at, 1, v);
    c.getListHeader().setParaCount(pl.getParagraphCount());
    return ok;
  }

  static int indexOf(ParagraphListInterface pl, Paragraph p) {
    for (int i = 0; i < pl.getParagraphCount(); i++) if (pl.getParagraph(i) == p) return i;
    return -1;
  }

  static boolean hasSection(Paragraph p) {
    for (Control c : controls(p)) if (c.getType() == ControlType.SectionDefine) return true;
    return false;
  }

  // at부터 n개 문단을 값(줄마다 문단 하나)으로 바꾼다. 문단 모양과 첫 글자(빈칸 말고) 모양을 그대로 쓰고 줄 배치는 지운다.
  // 개체가 든 문단이 끼어 있으면 건드리지 않는다
  static boolean swap(ParagraphListInterface pl, int at, int n, String value) throws Exception {
    for (int i = at; i < at + n; i++) if (!controls(pl.getParagraph(i)).isEmpty()) return false;
    Paragraph base = pl.getParagraph(at).clone();
    long shape = firstShape(base);
    base.deleteText(); base.deleteLineSeg(); base.deleteRangeTag();
    if (base.getCharShape() == null) base.createCharShape();
    base.getCharShape().getPositonShapeIdPairList().clear();
    base.getCharShape().addParaCharShape(0, shape);
    for (int i = 0; i < n; i++) pl.deleteParagraph(at);
    for (String line : value.split("\n", -1)) {
      Paragraph p = base.clone();
      if (!line.isEmpty()) {
        p.createText();
        Matcher m = Pattern.compile("\u0001(\\d+)\u0002").matcher(line);
        int from = 0;
        for (; m.find(); from = m.end()) {
          p.getText().addString(line.substring(from, m.start()));
          if (images.containsKey(Integer.parseInt(m.group(1)))) picture(p, images.get(Integer.parseInt(m.group(1))));
        }
        p.getText().addString(line.substring(from));
        p.getText().addNewCharControlChar().setCode(13);
      }
      pl.insertParagraph(at++, p);
      base.getHeader().getDivideSort().setValue((short) 0);   // 쪽·단 나눔은 첫 문단에만
    }
    return true;
  }

  /* ----- 그림: hwplib의 그림 넣기 예제 방식(그림으로 채운 사각형)을 글자처럼 취급으로 ----- */
  static Map<Integer, int[]> images = new HashMap<>();   // 번호 → { 문서 속 그림 번호, 가로, 세로 }
  static int pictures = 0;

  static int addImage(HWPFile f, String file) throws Exception {
    List<kr.dogfoot.hwplib.object.docinfo.BinData> list = f.getDocInfo().getBinDataList();
    int stream = 1;
    for (kr.dogfoot.hwplib.object.docinfo.BinData b : list) stream = Math.max(stream, b.getBinDataID() + 1);
    f.getBinData().addNewEmbeddedBinaryData(String.format("BIN%04X.png", stream), Files.readAllBytes(Paths.get(file)), BinDataCompress.ByStorageDefault);
    kr.dogfoot.hwplib.object.docinfo.BinData bd = new kr.dogfoot.hwplib.object.docinfo.BinData();
    bd.getProperty().setType(BinDataType.Embedding);
    bd.getProperty().setCompress(BinDataCompress.ByStorageDefault);
    bd.getProperty().setState(BinDataState.NotAccess);
    bd.setBinDataID(stream);
    bd.setExtensionForEmbedding("png");
    list.add(bd);
    return list.size();
  }

  static void picture(Paragraph p, int[] im) {
    int w = im[1], h = im[2];
    p.getText().addExtendCharForGSO();
    ControlRectangle r = (ControlRectangle) p.addNewGsoControl(GsoControlType.Rectangle);
    CtrlHeaderGso hd = r.getHeader();
    GsoHeaderProperty hp = hd.getProperty();
    hp.setLikeWord(true); hp.setApplyLineSpace(false);
    hp.setVertRelTo(VertRelTo.Para); hp.setVertRelativeArrange(RelativeArrange.TopOrLeft);
    hp.setHorzRelTo(HorzRelTo.Para); hp.setHorzRelativeArrange(RelativeArrange.TopOrLeft);
    hp.setVertRelToParaLimit(true); hp.setAllowOverlap(false);
    hp.setWidthCriterion(WidthCriterion.Absolute); hp.setHeightCriterion(HeightCriterion.Absolute);
    hp.setProtectSize(false); hp.setTextFlowMethod(TextFlowMethod.TakePlace); hp.setTextHorzArrange(TextHorzArrange.BothSides);
    hp.setObjectNumberSort(ObjectNumberSort.Figure);
    hd.setxOffset(0); hd.setyOffset(0); hd.setWidth(w); hd.setHeight(h); hd.setzOrder(pictures);
    hd.setOutterMarginLeft(0); hd.setOutterMarginRight(0); hd.setOutterMarginTop(0); hd.setOutterMarginBottom(0);
    hd.setInstanceId(0x5bb840e1L + pictures++); hd.setPreventPageDivide(false);
    hd.getExplanation().setBytes(null);
    ShapeComponentNormal sc = (ShapeComponentNormal) r.getShapeComponent();
    sc.setOffsetX(0); sc.setOffsetY(0); sc.setGroupingCount(0); sc.setLocalFileVersion(1);
    sc.setWidthAtCreate(w); sc.setHeightAtCreate(h); sc.setWidthAtCurrent(w); sc.setHeightAtCurrent(h);
    sc.setRotateAngle(0); sc.setRotateXCenter(w / 2); sc.setRotateYCenter(h / 2);
    sc.createLineInfo();
    LineInfo li = sc.getLineInfo();
    li.getProperty().setLineEndShape(LineEndShape.Flat);
    li.getProperty().setStartArrowShape(LineArrowShape.None); li.getProperty().setStartArrowSize(LineArrowSize.MiddleMiddle);
    li.getProperty().setEndArrowShape(LineArrowShape.None); li.getProperty().setEndArrowSize(LineArrowSize.MiddleMiddle);
    li.getProperty().setFillStartArrow(true); li.getProperty().setFillEndArrow(true);
    li.getProperty().setLineType(LineType.None);
    li.setOutlineStyle(OutlineStyle.Normal); li.setThickness(0); li.getColor().setValue(0);
    sc.createFillInfo();
    FillInfo fi = sc.getFillInfo();
    fi.getType().setPatternFill(false); fi.getType().setImageFill(true); fi.getType().setGradientFill(false);
    fi.createImageFill();
    fi.getImageFill().setImageFillType(ImageFillType.FitSize);
    fi.getImageFill().getPictureInfo().setBrightness((byte) 0);
    fi.getImageFill().getPictureInfo().setContrast((byte) 0);
    fi.getImageFill().getPictureInfo().setEffect(PictureEffect.RealPicture);
    fi.getImageFill().getPictureInfo().setBinItemID(im[0]);
    sc.createShadowInfo();
    sc.getShadowInfo().setType(ShadowType.None);
    sc.getShadowInfo().getColor().setValue(0xc4c4c4);
    sc.getShadowInfo().setOffsetX(283); sc.getShadowInfo().setOffsetY(283); sc.getShadowInfo().setTransparent((short) 0);
    sc.setMatrixsNormal();
    ShapeComponentRectangle sr = r.getShapeComponentRectangle();
    sr.setRoundRate((byte) 0);
    sr.setX1(0); sr.setY1(0); sr.setX2(w); sr.setY2(0); sr.setX3(w); sr.setY3(h); sr.setX4(0); sr.setY4(h);
  }

  static long firstShape(Paragraph p) {
    ParaCharShape cs = p.getCharShape();
    if (cs == null || cs.getPositonShapeIdPairList().isEmpty()) return 0;
    long pos = 0, at = 0;
    if (p.getText() != null) for (HWPChar c : p.getText().getCharList()) {
      if (c.getType() == HWPCharType.Normal && !Character.isWhitespace((char) c.getCode())) { at = pos; break; }
      pos += c.getCharSize();
    }
    long id = cs.getPositonShapeIdPairList().get(0).getShapeId();
    for (CharPositionShapeIdPair x : cs.getPositonShapeIdPairList()) if (x.getPosition() <= at) id = x.getShapeId();
    return id;
  }

  // 문단에서 개체 하나를 뺀다: 글 속 개체 자리 글자를 지우고 그 뒤 글자 모양 위치를 당긴다
  static boolean cut(Paragraph p, Control c) {
    int k = controls(p).indexOf(c), at = k < 0 || p.getText() == null ? -1 : p.getText().getCharIndexFromExtendCharIndex(k);
    if (at < 0) return false;
    List<HWPChar> chars = p.getText().getCharList();
    long pos = 0, size = chars.get(at).getCharSize();
    for (int i = 0; i < at; i++) pos += chars.get(i).getCharSize();
    chars.remove(at);
    p.getControlList().remove(k);
    if (p.getCharShape() != null) {
      List<CharPositionShapeIdPair> ps = p.getCharShape().getPositonShapeIdPairList();
      for (CharPositionShapeIdPair x : ps) if (x.getPosition() > pos) x.setPosition(x.getPosition() - size);
      for (int i = ps.size() - 2; i >= 0; i--) if (ps.get(i).getPosition() == ps.get(i + 1).getPosition()) ps.remove(i);
    }
    p.deleteLineSeg(); p.deleteRangeTag();
    return true;
  }

  static String q(String s) {
    StringBuilder b = new StringBuilder("\"");
    for (char ch : s.toCharArray()) {
      if (ch == '"' || ch == '\\') b.append('\\').append(ch);
      else if (ch < 0x20) b.append(String.format("\\u%04x", (int) ch));
      else b.append(ch);
    }
    return b.append('"').toString();
  }
}
`;

/* ---------- Java ---------- */
let javaFound = null;
async function findJava(){
  const bins = [process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin', 'java'), 'java', '/opt/homebrew/opt/openjdk/bin/java', '/usr/local/opt/openjdk/bin/java'].filter(Boolean);
  for (const bin of bins){
    try {
      const { err, out } = await run(bin, ['-version'], { timeout: 20000 });
      const m = /version "(\d+)(?:\.(\d+))?/.exec(err + out);
      if (!m) continue;
      const major = m[1] === '1' ? Number(m[2]) : Number(m[1]);   // 1.8 → 8
      const real = bin === 'java' ? await realJava() : bin, javac = path.join(path.dirname(real), 'javac');
      return { bin: real, major, javac: fs.existsSync(javac) ? javac : null };
    } catch { /* 다음 후보 */ }
  }
  return null;
}
// PATH의 java가 macOS 껍데기(/usr/bin/java)일 수 있어 실제 JDK 위치를 java에게 묻는다
async function realJava(){
  try {
    const { err } = await run('java', ['-XshowSettings:properties', '-version'], { timeout: 20000 });
    const home = /java\.home = (.+)/.exec(err);
    if (home) return path.join(home[1].trim(), 'bin', 'java');
  } catch { /* 아래로 */ }
  return 'java';
}
async function java(){
  javaFound ||= findJava();
  const j = await javaFound;
  if (!j){ javaFound = null; fail(NO_JAVA); }
  if (j.major < 11) fail(`이 컴퓨터의 Java(${j.major})가 너무 오래됐어요. Java 17 이상을 설치해 주세요`);
  return j;
}
export const javaVersion = async () => (await java()).major;

/* ---------- hwplib 받기·도우미 준비 ---------- */
let libReady = null;
async function fetchJar(file){
  let buf;
  try {
    const res = await fetch(JAR.url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(String(res.status));
    buf = Buffer.from(await res.arrayBuffer());
  } catch { fail('HWP 도구(hwplib)를 받지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요'); }
  if (sha256(buf) !== JAR.sha256) fail('받은 HWP 도구(hwplib)가 원래 파일과 달라서 쓰지 않았어요. 잠시 뒤 다시 해 주세요');
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, buf); fs.renameSync(tmp, file);
}
async function prepare(){
  const j = await java(), dir = libDir(), jar = path.join(dir, JAR.name);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(jar) && sha256(fs.readFileSync(jar)) !== JAR.sha256){
    fs.rmSync(jar, { force: true });
    fail('HWP 도구(hwplib) 파일이 바뀌어 있어서 지웠어요. 다시 하면 새로 받아요');
  }
  if (!fs.existsSync(jar)) await fetchJar(jar);
  // 도우미는 소스·Java 버전 해시 이름 폴더에 한 번 컴파일해 둔다. javac가 없으면 java가 소스를 바로 실행한다
  const tag = sha256(`${JAVA_SRC}${JAR.sha256}${j.major}`).slice(0, 12), home = path.join(dir, `hwpform-${tag}`), src = path.join(home, 'HwpForm.java');
  if (!fs.existsSync(path.join(home, 'HwpForm.class')) && !(fs.existsSync(src) && !j.javac)){
    const tmp = fs.mkdtempSync(path.join(dir, '.hwpform-'));
    try {
      fs.writeFileSync(path.join(tmp, 'HwpForm.java'), JAVA_SRC);
      if (j.javac) await run(j.javac, ['-nowarn', '-encoding', 'UTF-8', '-cp', jar, '-d', tmp, path.join(tmp, 'HwpForm.java')], { timeout: 120000 });
      fs.rmSync(home, { recursive: true, force: true });
      fs.renameSync(tmp, home);
      for (const d of fs.readdirSync(dir)) if (d.startsWith('hwpform-') && d !== path.basename(home)) fs.rmSync(path.join(dir, d), { recursive: true, force: true });   // 지난 버전 도우미
    } catch (e){
      if (e.user) throw e;
      fail('HWP 도구를 준비하지 못했어요. Java 설치를 확인해 주세요');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  const compiled = fs.existsSync(path.join(home, 'HwpForm.class'));
  return { java: j.bin, cp: compiled ? [jar, home].join(path.delimiter) : jar, main: compiled ? 'HwpForm' : src };
}
export async function ensureLib(){
  libReady ||= prepare().catch(e => { libReady = null; throw e; });
  return libReady;
}

async function callJava(args){
  const lib = await ensureLib();
  let out;
  try { ({ out } = await run(lib.java, ['-Djava.awt.headless=true', '-cp', lib.cp, lib.main, ...args], { timeout: 120000 })); }
  catch (e){ out = e.out || ''; }
  let r;
  try { r = JSON.parse(String(out).trim().split('\n').pop()); } catch { fail('HWP 도구가 중간에 멈췄어요. 다시 해 주세요'); }
  if (r.ok) return r;
  if (r.error === 'password') fail('암호가 걸린 HWP라 열 수 없어요. 한글에서 암호를 풀고 다시 저장하거나 직접 채워 주세요');
  if (r.error === 'distribution') fail('배포용 HWP라 고칠 수 없어요(편집이 막혀 있어요). 직접 채워 주세요');
  fail('양식을 읽지 못했어요. 파일이 깨졌을 수 있으니 원본을 다시 받아 주세요');
}

/* ---------- 양식 확인 ---------- */
function check(file){
  if (!/\.hwp$/i.test(file)) fail(NOT_HWP);
  let head;
  try { const fd = fs.openSync(file, 'r'); head = Buffer.alloc(32); fs.readSync(fd, head, 0, 32, 0); fs.closeSync(fd); }
  catch { fail('양식 파일을 찾지 못했어요. 다시 받아 주세요'); }
  if (head.subarray(0, 2).toString() === 'PK') fail(NOT_HWP);   // 이름만 .hwp인 .hwpx
  if (head.toString('latin1').startsWith('HWP Document File')) fail('아주 오래된 한글(HWP 3) 양식이라 열 수 없어요. 직접 채워 주세요');
  if (!head.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) fail('양식을 읽지 못했어요. 파일이 깨졌을 수 있으니 원본을 다시 받아 주세요');
}
const SLOT = /^[_\s]*_{4,}[_\s]*$/;
async function readRaw(file){
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-hwp-'));
  let r, form;
  try {
    r = await callJava(['read', path.resolve(file), path.join(tmp, 'form.json')]);
    form = JSON.parse(fs.readFileSync(path.join(tmp, 'form.json'), 'utf8'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  for (const t of form.tables) for (const c of t.rows.flat()){
    c.text = c.paras.map(p => p.t).filter(Boolean).join('\n');
    c.blank = c.paras.every(p => !p.t && !p.c);
    c.slots = c.paras.flatMap((p, i) => !p.c && SLOT.test(p.t) ? [i] : []);
  }
  return { ...form, distribution: r.distribution };
}

/* ---------- 블록 단위 읽기·고치기(docs.mjs가 쓴다 — 확장자는 보지 않는다) ---------- */
async function inTmp(work){
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-hwp-'));
  try { return await work(tmp); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
// → { blocks: [{ kind: 'para', text, lock } | { kind: 'table', rows }], distribution } — 블록마다 문단 정보(s 구역·par 문단 번호·sec·obj·ctl·brk)
export const readBlocks = file => inTmp(async tmp => {
  const r = await callJava(['doc', path.resolve(file), path.join(tmp, 'doc.json')]);
  return { ...JSON.parse(fs.readFileSync(path.join(tmp, 'doc.json'), 'utf8')), distribution: r.distribution };
});
// ops: [[명령, 블록, 행, 열, 문단, 글]] — para·cell·cpara·cutt·cutp·unbreak·image. part에 저장하고 된 명령의 번호를 돌려준다
export const editBlocks = (src, part, ops) => inTmp(async tmp => {
  const line = ([op, b, row = -1, col = -1, para = -1, text = '']) => [op, b, row, col, para, Buffer.from(text).toString('base64')].join('\t');
  fs.writeFileSync(path.join(tmp, 'ops.tsv'), ops.map(line).join('\n'));
  return (await callJava(['edit', path.resolve(src), part, path.join(tmp, 'ops.tsv')])).done;
});

/* ---------- 채울 칸 찾기 ---------- */
// 1) 라벨 칸 오른쪽(아는 라벨이면 없을 때 아래) 빈칸  2) 칸 안 밑줄(____)만 있는 문단 — 라벨은 같은 칸 첫 줄(질문)이나 왼쪽 칸
const KNOWN = /이름|성명|연락처|전화|휴대폰|핸드폰|이메일|e-?mail|주소|생년월일|소속|직업|직장|학교|학과|작품명|제목|의미|설명|이유|명칭|슬로건|팀명|대표|성별|나이|연령|부문|분야/i;
// 번호·콜론·괄호 설명을 빼고, '성    명'처럼 글자마다 띄운 것은 붙인다
function tidy(t, paren = false){
  let s = String(t).replace(/^\s*\d+(-\d+)?\s*[.)]\s*/, '').replace(/[:：*※]/g, ' ');
  if (!paren) s = s.replace(/\([^)]*\)|\[[^\]]*\]|<[^>]*>/g, ' ');
  const w = s.trim().split(/\s+/).filter(Boolean);
  return w.every(x => x.length === 1) ? w.join('') : w.join(' ');
}
const keyOf = t => String(t).replace(/[\s:：*※]/g, '').toLowerCase();
const cut = (t, n) => t.length > n ? `${t.slice(0, n)}…` : t;
function fieldsOf(tables){
  const out = [], used = new Set(), names = new Set();
  const add = (base, full, t, cell, para) => {
    let label = names.has(base) && full ? full : base;
    for (let n = 2; names.has(label); n++) label = `${base} ${n}`;
    names.add(label);
    out.push({ label, table: t.index, row: cell.row, col: cell.col, para });
  };
  for (const t of tables){
    const cells = t.rows.flat();
    const at = (r, c) => cells.find(x => x.row <= r && r < x.row + x.rowSpan && x.col <= c && c < x.col + x.colSpan);
    const labelOf = cell => {
      const base = tidy(cell.text), known = KNOWN.test(base);
      return base && !cell.slots.length && base.length <= (known ? 20 : 10) ? { base, full: tidy(cell.text, true), known } : null;
    };
    for (const cell of cells){
      const l = !cell.blank && labelOf(cell);
      const pick = l && [at(cell.row, cell.col + cell.colSpan), l.known && at(cell.row + cell.rowSpan, cell.col)].find(x => x && x.blank && !used.has(x));
      if (!pick) continue;
      used.add(pick);
      add(l.base, l.full, t, pick, -1);
    }
    for (const cell of cells) for (const i of cell.slots){
      const q = cell.paras.slice(0, i).map(p => p.t).find(x => x && !SLOT.test(x));
      const l = !q && cell.col > 0 && labelOf(at(cell.row, cell.col - 1) || { text: '', slots: [] });
      if (q || l) add(q ? cut(q, 40) : l.base, q ? '' : l.full, t, cell, i);
    }
  }
  return out.sort((a, b) => a.table - b.table || a.row - b.row || a.col - b.col || a.para - b.para);
}

/* ---------- 공개 API ---------- */
export async function readForm(file){
  check(file);
  const r = await readRaw(file);
  return { text: r.text.slice(0, 20000), tables: r.tables.map(t => ({ index: t.index, rows: t.rows.map(row => row.map(({ text, row: ro, col, rowSpan, colSpan }) => ({ text, row: ro, col, rowSpan, colSpan }))) })),
    fields: fieldsOf(r.tables).map(({ para: _, ...f }) => f) };
}

export async function fillForm(src, out, values = {}){
  check(src);
  if (!/\.hwp$/i.test(out)) fail('채운 양식은 .hwp 이름으로 저장해야 해요');
  const r = await readRaw(src), fields = fieldsOf(r.tables);
  if (r.distribution) fail('배포용 HWP라 고칠 수 없어요(편집이 막혀 있어요). 직접 채워 주세요');
  const want = new Map(Object.entries(values || {}).filter(([, v]) => !blank(v)).map(([k, v]) => [keyOf(k), v]));
  // 한 칸에 밑줄 자리가 여럿이면 뒤 문단부터 바꿔야 앞 문단 번호가 밀리지 않는다
  const todo = fields.filter(f => want.has(keyOf(f.label))).sort((a, b) => a.table - b.table || a.row - b.row || a.col - b.col || b.para - a.para);
  // 탭·제어 글자는 빼고, 줄바꿈만 문단으로 남긴다
  const clean = v => String(v).replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim();
  const tsv = todo.map(f => [f.table, f.row, f.col, f.para, Buffer.from(clean(want.get(keyOf(f.label)))).toString('base64')].join('\t')).join('\n');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-hwp-')), dest = path.resolve(out), part = path.join(path.dirname(dest), `.${path.basename(dest)}.${process.pid}.tmp`);
  let done = [];
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (todo.length){
      fs.writeFileSync(path.join(tmp, 'cells.tsv'), tsv);
      done = (await callJava(['fill', path.resolve(src), part, path.join(tmp, 'cells.tsv')])).done;
    } else fs.copyFileSync(src, part);
    fs.renameSync(part, dest);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(part, { force: true }); }
  const filled = done.map(i => todo[i].label), known = new Set(fields.map(f => keyOf(f.label)));
  return { filled, missing: fields.map(f => f.label).filter(l => !filled.includes(l)),
    unknown: Object.keys(values || {}).filter(k => !blank(values[k]) && !known.has(keyOf(k))) };
}
