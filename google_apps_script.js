// =======================================================================
// PKC Management Consulting — Accounts Payable OCR Apps Script Extensions
// (Tally Ledger Sync & Accounts Payable Invoice Database)
// =======================================================================

// Both database tabs are targeted strictly by their integer Sheet ID (GID),
// never by name, so renaming a tab in the UI never breaks data persistence.
const INVOICE_DATABASE_GID = 0;
const ITEM_DATABASE_GID = 432714987;

function getSheetByGid(ss, targetGid) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === Number(targetGid)) {
      return sheets[i];
    }
  }
  return null;
}

function findFirstAvailableRow(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 2;
  // If Item sheet (GID 432714987), Invoice Number is in Col B (col 2). Otherwise Col F (col 6).
  var colIndex = (sheet.getSheetId() === Number(ITEM_DATABASE_GID)) ? 2 : 6;
  var colValues = sheet.getRange(1, colIndex, lastRow, 1).getValues();
  for (var r = 1; r < colValues.length; r++) {
    var val = colValues[r][0];
    if (val === "" || val === null || val === undefined) {
      return r + 1;
    }
  }
  return lastRow + 1;
}

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('PKC AP Automation')
    .addItem('1. L1 Data Entry (Pending L1)', 'launchL1Wizard')
    .addItem('2. L2 Final Approval (Pending L2)', 'launchL2Wizard')
    .addSeparator()
    .addItem('Setup Invoice Sheet Headers', 'setupInvoiceSheet')
    .addItem('Setup Item Sheet Headers', 'setupItemSheet')
    .addItem('Export Approved to Tally (Excel)', 'exportApprovedToTally')
    .addToUi();
}

// Invoice-wise Database (GID 0) header sequence — exactly 24 columns (A through X).
// Kept in sync with backend/main.py map_invoice_to_bill_data.
// COLUMNS Y & Z ARE RESERVED FOR FORMULAS (Processing Days & Status) AND MUST REMAIN UNTOUCHED.
var INVOICE_HEADERS = [
  "Timestamp",              // A (Col 1)
  "File Name",               // B (Col 2)
  "Vendor Name",              // C (Col 3)
  "Invoice Date",              // D (Col 4)
  "Expense Category",           // E (Col 5)
  "Invoice Number",              // F (Col 6)
  "Vendor GSTIN",                 // G (Col 7)
  "Taxable Amount",                 // H (Col 8)
  "CGST",                             // I (Col 9)
  "SGST",                              // J (Col 10)
  "IGST",                               // K (Col 11)
  "Cess",                                // L (Col 12)
  "Discount",                             // M (Col 13)
  "Round Off",                             // N (Col 14)
  "Additional Charges",                     // O (Col 15)
  "Total Amount",                           // P (Col 16)
  "Due Date",                                // Q (Col 17)
  "Confidence",                                // R (Col 18)
  "Tally Ledger Name",                           // S (Col 19)
  "Approval Status",                              // T (Col 20)
  "Approver Name",                                 // U (Col 21)
  "Approval Date",                                  // V (Col 22)
  "Rejection Reason",                                // W (Col 23)
  "Remarks"                                           // X (Col 24)
];

// Item-wise Database (GID 432714987) header sequence — exactly 24 columns (A through X).
var ITEM_HEADERS = [
  "Timestamp",                 // A (Col 1)
  "Invoice Number",            // B (Col 2)
  "Vendor Name",                // C (Col 3)
  "Invoice Date",                // D (Col 4)
  "Line Type",                    // E (Col 5)
  "Item Description",              // F (Col 6)
  "HSN/SAC",                        // G (Col 7)
  "Quantity",                        // H (Col 8)
  "Unit",                              // I (Col 9)
  "Unit Price",                         // J (Col 10)
  "Taxable Amount",                      // K (Col 11)
  "Tax Rate (%)",                         // L (Col 12)
  "CGST Amount",                           // M (Col 13)
  "SGST Amount",                            // N (Col 14)
  "IGST Amount",                             // O (Col 15)
  "Cess Amount",                               // P (Col 16)
  "Discount Amount",                            // Q (Col 17)
  "Line Total",                                  // R (Col 18)
  "Supplier Ledger Name",                         // S (Col 19)
  "Mapped Tally Stock Item",                       // T (Col 20)
  "Approval Status",                                // U (Col 21)
  "Approver Name",                                   // V (Col 22)
  "Approval Date",                                    // W (Col 23)
  "Rejection Reason"                                   // X (Col 24)
];

function setupInvoiceSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getSheetByGid(ss, INVOICE_DATABASE_GID) || ss.getActiveSheet();
  var headers = INVOICE_HEADERS;

  // Strictly set headers across columns 1 to 24 (A to X)
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  var range = sheet.getRange(1, 1, 1, headers.length);
  range.setFontWeight("bold");
  range.setBackground("#0F2942");
  range.setFontColor("#FFFFFF");

  // Approval Status dropdown in Col T (column 20)
  var cell = sheet.getRange("T2:T5000");
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Pending L1", "Pending L2", "Approved", "Rejected"], true)
    .build();
  cell.setDataValidation(rule);

  SpreadsheetApp.getUi().alert("Invoice sheet headers setup complete! Approval Status validation dropdown has been configured across Columns A-X.");
}

function setupItemSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var itemSheet = getSheetByGid(ss, ITEM_DATABASE_GID) || ss.getActiveSheet();
  var itemHeaders = ITEM_HEADERS;

  // Strictly set headers across columns 1 to 24 (A to X)
  itemSheet.getRange(1, 1, 1, itemHeaders.length).setValues([itemHeaders]);
  var range = itemSheet.getRange(1, 1, 1, itemHeaders.length);
  range.setFontWeight("bold");
  range.setBackground("#0F2942");
  range.setFontColor("#FFFFFF");

  // Line Type validation dropdown in Col E (column 5)
  var lineTypeRange = itemSheet.getRange("E2:E5000");
  var lineTypeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Stock Item", "Service", "Additional Charge", "Discount", "Round Off"], true)
    .build();
  lineTypeRange.setDataValidation(lineTypeRule);

  // Approval Status dropdown in Col U (column 21)
  var cell = itemSheet.getRange("U2:U5000");
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Pending L1", "Pending L2", "Approved", "Rejected"], true)
    .build();
  cell.setDataValidation(rule);

  SpreadsheetApp.getUi().alert("Item sheet headers setup complete! Line Type and Approval Status validations configured across Columns A-X.");
}

// =======================================================================
// Approval Workflow Helpers & Wizards (Pending L1 / Pending L2)
// =======================================================================

function getPendingInvoices(targetStage) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dbSheet = getSheetByGid(ss, INVOICE_DATABASE_GID);
  if (!dbSheet) return [];

  var lastRow = dbSheet.getLastRow();
  if (lastRow <= 1) return [];

  // Strictly read columns 1 through 24 (A to X), never past Column X
  var values = dbSheet.getRange(2, 1, lastRow - 1, 24).getValues();
  var pendingList = [];

  var stageNorm = targetStage ? String(targetStage).trim().toLowerCase() : "";

  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var invNo = String(row[5] || "").trim(); // Col F (Invoice Number)
    var vendor = String(row[2] || "").trim(); // Col C (Vendor Name)

    if (!invNo && !vendor && !row[0]) continue;

    var status = String(row[19] || "").trim(); // Col T (Approval Status)
    var statusNorm = status.toLowerCase();

    var isMatch = false;
    if (!stageNorm) {
      isMatch = statusNorm.indexOf("pending") !== -1 || statusNorm === "";
    } else if (stageNorm === "pending l1") {
      isMatch = (statusNorm === "pending l1" || statusNorm === "pending" || statusNorm === "");
    } else if (stageNorm === "pending l2") {
      isMatch = (statusNorm === "pending l2");
    } else {
      isMatch = (statusNorm === stageNorm);
    }

    if (isMatch) {
      pendingList.push({
        rowIndex: r + 2,
        timestamp: row[0] instanceof Date ? Utilities.formatDate(row[0], Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm") : String(row[0] || ""),
        fileName: String(row[1] || ""),
        vendorName: vendor,
        invoiceDate: row[3] instanceof Date ? Utilities.formatDate(row[3], Session.getScriptTimeZone(), "yyyy-MM-dd") : String(row[3] || ""),
        category: String(row[4] || ""),
        invoiceNumber: invNo,
        vendorGstin: String(row[6] || ""),
        taxableAmount: Number(row[7]) || 0,
        cgst: Number(row[8]) || 0,
        sgst: Number(row[9]) || 0,
        igst: Number(row[10]) || 0,
        cess: Number(row[11]) || 0,
        discount: Number(row[12]) || 0,
        roundOff: Number(row[13]) || 0,
        additionalCharges: Number(row[14]) || 0,
        totalAmount: Number(row[15]) || 0,
        dueDate: String(row[16] || ""),
        confidence: String(row[17] || ""),
        tallyLedgerName: String(row[18] || ""),
        approvalStatus: status || "Pending L1",
        approverName: String(row[20] || ""),
        approvalDate: String(row[21] || ""),
        rejectionReason: String(row[22] || ""),
        remarks: String(row[23] || "")
      });
    }
  }

  return pendingList;
}

function launchL1Wizard() {
  var records = getPendingInvoices("Pending L1");
  if (!records || records.length === 0) {
    SpreadsheetApp.getUi().alert("PKC AP Automation: No pending records found with status 'Pending L1'.");
    return;
  }
  var html = buildWizardHtml("L1", records);
  var htmlOutput = HtmlService.createHtmlOutput(html)
    .setWidth(920)
    .setHeight(620)
    .setTitle("1. L1 Data Entry (Pending L1) Review");
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, "1. L1 Data Entry (Pending L1) Review");
}

function launchL2Wizard() {
  var records = getPendingInvoices("Pending L2");
  if (!records || records.length === 0) {
    SpreadsheetApp.getUi().alert("PKC AP Automation: No pending records found with status 'Pending L2'.");
    return;
  }
  var html = buildWizardHtml("L2", records);
  var htmlOutput = HtmlService.createHtmlOutput(html)
    .setWidth(920)
    .setHeight(620)
    .setTitle("2. L2 Final Approval (Pending L2) Review");
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, "2. L2 Final Approval (Pending L2) Review");
}

function submitReviewBatch(updates) {
  if (!updates) {
    return { status: "error", message: "No updates provided." };
  }
  if (!Array.isArray(updates)) {
    updates = [updates];
  }
  if (updates.length === 0) {
    return { status: "error", message: "Updates list is empty." };
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dbSheet = getSheetByGid(ss, INVOICE_DATABASE_GID);
  if (!dbSheet) {
    return { status: "error", message: "Invoice Database sheet (GID " + INVOICE_DATABASE_GID + ") not found." };
  }

  var itemSheet = getSheetByGid(ss, ITEM_DATABASE_GID);

  var lastRow = dbSheet.getLastRow();
  var existingValues = [];
  if (lastRow > 1) {
    // Strictly read columns 1 through 24
    existingValues = dbSheet.getRange(2, 1, lastRow - 1, 24).getValues();
  }

  var updatedCount = 0;
  var timestampStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  for (var u = 0; u < updates.length; u++) {
    var upd = updates[u];
    var targetRow = -1;

    if (upd.rowIndex && upd.rowIndex >= 2 && upd.rowIndex <= lastRow) {
      targetRow = upd.rowIndex;
    } else {
      var searchInv = String(upd.invoiceNumber || upd.invoice_number || upd.invoice_no || "").trim().toLowerCase();
      var searchVendor = String(upd.vendorName || upd.vendor_name || upd.merchant || "").trim().toLowerCase();
      var cleanSearchInv = searchInv.replace(/[^a-z0-9]/g, "");

      if (cleanSearchInv.length > 0 && existingValues.length > 0) {
        for (var r = 0; r < existingValues.length; r++) {
          var rowInv = String(existingValues[r][5] || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
          var rowVendor = String(existingValues[r][2] || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
          if (rowInv === cleanSearchInv) {
            if (!searchVendor || rowVendor === searchVendor.replace(/[^a-z0-9]/g, "") || rowVendor.indexOf(searchVendor) !== -1) {
              targetRow = r + 2;
              break;
            }
          }
        }
      }
    }

    if (targetRow >= 2) {
      var newStatus = upd.approvalStatus || upd.approval_status || "Pending L1";
      var approver = upd.approverName || upd.approver_name || "";
      var approvalDate = upd.approvalDate || upd.approval_date || timestampStr;
      var rejReason = upd.rejectionReason || upd.rejection_reason || "";
      var remarks = upd.remarks || "";

      // Strict Sheet Protection Constraint:
      // Only update Columns T through X (columns 20 to 24). Width is exactly 5.
      // Columns Y (Processing Days) and Z (Status) REMAIN UNTOUCHED.
      dbSheet.getRange(targetRow, 20, 1, 5).setValues([[
        newStatus,
        approver,
        approvalDate,
        rejReason,
        remarks
      ]]);
      updatedCount++;

      // Cascade approval status update to matching rows in itemSheet (Columns U through X: 21 to 24)
      if (itemSheet) {
        var itemLastRow = itemSheet.getLastRow();
        if (itemLastRow > 1) {
          var itemVals = itemSheet.getRange(2, 1, itemLastRow - 1, 24).getValues();
          var matchedInvNo = String(dbSheet.getRange(targetRow, 6).getValue() || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
          for (var ir = 0; ir < itemVals.length; ir++) {
            var itmInv = String(itemVals[ir][1] || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
            if (itmInv === matchedInvNo && matchedInvNo.length > 0) {
              // Strictly columns 21 to 24 (Col U to Col X). Width = 4. Never past Column X!
              itemSheet.getRange(ir + 2, 21, 1, 4).setValues([[
                newStatus,
                approver,
                approvalDate,
                rejReason
              ]]);
            }
          }
        }
      }
    }
  }

  return {
    status: "success",
    count: updatedCount,
    message: "Successfully updated " + updatedCount + " invoice record(s) in database."
  };
}

function buildWizardHtml(stage, records) {
  var isL1 = stage === "L1";
  var stageTitle = isL1 ? "L1 Data Entry & Preliminary Review" : "L2 Final Approval Sign-Off";
  var defaultNextStatus = isL1 ? "Pending L2" : "Approved";
  var initialUser = "";
  try {
    initialUser = Session.getActiveUser().getEmail() || "";
  } catch (e) {
    initialUser = "";
  }

  var jsonRecords = JSON.stringify(records);

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">';
  html += '<style>';
  html += 'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #F8FAFC; color: #1E293B; margin: 0; padding: 16px; font-size: 12px; }';
  html += '.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; border-bottom: 2px solid #E2E8F0; padding-bottom: 10px; }';
  html += '.title { font-size: 16px; font-weight: 700; color: #0F2942; margin: 0; }';
  html += '.badge { background: #E0F2FE; color: #0369A1; padding: 4px 10px; border-radius: 9999px; font-weight: 600; font-size: 11px; }';
  html += '.controls { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 12px; background: #FFFFFF; padding: 12px; border-radius: 8px; border: 1px solid #CBD5E1; margin-bottom: 12px; }';
  html += '.control-group label { display: block; font-weight: 600; margin-bottom: 4px; color: #475569; font-size: 11px; text-transform: uppercase; }';
  html += '.control-group input, .control-group select { width: 100%; box-sizing: border-box; padding: 6px 8px; border: 1px solid #CBD5E1; border-radius: 6px; font-size: 12px; outline: none; }';
  html += '.table-container { max-height: 340px; overflow-y: auto; background: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); margin-bottom: 14px; }';
  html += 'table { width: 100%; border-collapse: collapse; text-align: left; }';
  html += 'th { background: #0F2942; color: #FFFFFF; padding: 8px 10px; font-weight: 600; font-size: 11px; text-transform: uppercase; position: sticky; top: 0; z-index: 1; }';
  html += 'td { padding: 8px 10px; border-bottom: 1px solid #F1F5F9; vertical-align: middle; }';
  html += 'tr:hover { background: #F8FAFC; }';
  html += '.text-right { text-align: right; }';
  html += '.text-center { text-align: center; }';
  html += '.btn-bar { display: flex; justify-content: space-between; align-items: center; }';
  html += '.btn { padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer; border: none; font-size: 12px; transition: background 0.15s; }';
  html += '.btn-primary { background: #10B981; color: #FFFFFF; }';
  html += '.btn-primary:hover { background: #059669; }';
  html += '.btn-secondary { background: #E2E8F0; color: #334155; }';
  html += '.btn-secondary:hover { background: #CBD5E1; }';
  html += '.status-pill { padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 10px; display: inline-block; }';
  html += '.status-pending { background: #FEF3C7; color: #B45309; }';
  html += '.status-approved { background: #D1FAE5; color: #065F46; }';
  html += '.status-rejected { background: #FEE2E2; color: #991B1B; }';
  html += '#spinner { display: none; color: #0F2942; font-weight: 600; }';
  html += '</style></head><body>';

  html += '<div class="header">';
  html += '  <h2 class="title">PKC AP Automation — ' + stageTitle + '</h2>';
  html += '  <span class="badge" id="recordCount">' + records.length + ' Pending Invoices</span>';
  html += '</div>';

  html += '<div class="controls">';
  html += '  <div class="control-group">';
  html += '    <label>Approver Name / Email</label>';
  html += '    <input type="text" id="commonApprover" value="' + initialUser + '" placeholder="e.g. Accounts Entry / Manager">';
  html += '  </div>';
  html += '  <div class="control-group">';
  html += '    <label>Batch Action For Selected</label>';
  html += '    <select id="batchActionSelect" onchange="applyBatchAction()">';
  if (isL1) {
    html += '      <option value="Pending L2" selected>Route to Pending L2</option>';
    html += '      <option value="Approved">Approve Directly</option>';
    html += '      <option value="Rejected">Reject</option>';
  } else {
    html += '      <option value="Approved" selected>Approve (Final Sign-off)</option>';
    html += '      <option value="Rejected">Reject</option>';
  }
  html += '    </select>';
  html += '  </div>';
  html += '  <div class="control-group">';
  html += '    <label>Batch Remarks / Rejection Reason</label>';
  html += '    <input type="text" id="commonRemarks" placeholder="Optional audit remark or note">';
  html += '  </div>';
  html += '</div>';

  html += '<div class="table-container">';
  html += '  <table>';
  html += '    <thead>';
  html += '      <tr>';
  html += '        <th class="text-center" style="width:36px;"><input type="checkbox" id="selectAll" checked onclick="toggleSelectAll(this)"></th>';
  html += '        <th>Invoice #</th>';
  html += '        <th>Vendor</th>';
  html += '        <th>Date</th>';
  html += '        <th class="text-right">Taxable</th>';
  html += '        <th class="text-right">Total</th>';
  html += '        <th>Current</th>';
  html += '        <th style="width:140px;">New Status</th>';
  html += '        <th>Remarks</th>';
  html += '      </tr>';
  html += '    </thead>';
  html += '    <tbody id="invoiceTableBody"></tbody>';
  html += '  </table>';
  html += '</div>';

  html += '<div class="btn-bar">';
  html += '  <div>';
  html += '    <button type="button" class="btn btn-secondary" onclick="google.script.host.close()">Cancel</button>';
  html += '  </div>';
  html += '  <div style="display:flex;align-items:center;gap:12px;">';
  html += '    <span id="spinner">Processing updates strictly across Columns A-X...</span>';
  html += '    <button type="button" id="submitBtn" class="btn btn-primary" onclick="submitBatch()">Submit Review Batch</button>';
  html += '  </div>';
  html += '</div>';

  html += '<script>';
  html += 'var records = ' + jsonRecords + ';';
  html += 'var isL1 = ' + isL1 + ';';
  html += 'var defaultStatus = "' + defaultNextStatus + '";';

  html += 'function renderTable() {';
  html += '  var tbody = document.getElementById("invoiceTableBody");';
  html += '  tbody.innerHTML = "";';
  html += '  records.forEach(function(rec, idx) {';
  html += '    var tr = document.createElement("tr");';
  html += '    var optHtml = isL1 ? ';
  html += '      ("<option value=\'Pending L2\' " + (rec.approvalStatus === "Pending L2" ? "selected" : "") + ">Pending L2</option>" +';
  html += '       "<option value=\'Approved\' " + (rec.approvalStatus === "Approved" ? "selected" : "") + ">Approved</option>" +';
  html += '       "<option value=\'Rejected\' " + (rec.approvalStatus === "Rejected" ? "selected" : "") + ">Rejected</option>") : ';
  html += '      ("<option value=\'Approved\' selected>Approved</option>" +';
  html += '       "<option value=\'Rejected\'>Rejected</option>");';
  html += '    tr.innerHTML = ';
  html += '      "<td class=\'text-center\'><input type=\'checkbox\' class=\'row-select\' data-idx=\'" + idx + "\' checked></td>" +';
  html += '      "<td><b>" + (rec.invoiceNumber || "—") + "</b></td>" +';
  html += '      "<td>" + (rec.vendorName || "—") + "</td>" +';
  html += '      "<td>" + (rec.invoiceDate || "—") + "</td>" +';
  html += '      "<td class=\'text-right font-mono\'>" + (Number(rec.taxableAmount || 0)).toFixed(2) + "</td>" +';
  html += '      "<td class=\'text-right font-mono\'><b>" + (Number(rec.totalAmount || 0)).toFixed(2) + "</b></td>" +';
  html += '      "<td><span class=\'status-pill status-pending\'>" + (rec.approvalStatus || "Pending L1") + "</span></td>" +';
  html += '      "<td><select id=\'status_\' + idx + \' style=\'padding:3px;border-radius:4px;\'>" + optHtml + "</select></td>" +';
  html += '      "<td><input type=\'text\' id=\'rem_\' + idx + \' value=\'" + (rec.remarks || "").replace(/"/g, "&quot;") + "\' style=\'width:100%;box-sizing:border-box;padding:3px;font-size:11px;\'></td>";';
  html += '    tbody.appendChild(tr);';
  html += '  });';
  html += '}';

  html += 'function toggleSelectAll(master) {';
  html += '  var checkboxes = document.querySelectorAll(".row-select");';
  html += '  checkboxes.forEach(function(cb) { cb.checked = master.checked; });';
  html += '}';

  html += 'function applyBatchAction() {';
  html += '  var action = document.getElementById("batchActionSelect").value;';
  html += '  var commonRem = document.getElementById("commonRemarks").value;';
  html += '  var checkboxes = document.querySelectorAll(".row-select");';
  html += '  checkboxes.forEach(function(cb) {';
  html += '    if (cb.checked) {';
  html += '      var idx = cb.getAttribute("data-idx");';
  html += '      var sel = document.getElementById("status_" + idx);';
  html += '      if (sel) sel.value = action;';
  html += '      if (commonRem) {';
  html += '        var remInput = document.getElementById("rem_" + idx);';
  html += '        if (remInput) remInput.value = commonRem;';
  html += '      }';
  html += '    }';
  html += '  });';
  html += '}';

  html += 'function submitBatch() {';
  html += '  var approver = document.getElementById("commonApprover").value.trim();';
  html += '  var checkboxes = document.querySelectorAll(".row-select");';
  html += '  var updates = [];';
  html += '  checkboxes.forEach(function(cb) {';
  html += '    if (cb.checked) {';
  html += '      var idx = Number(cb.getAttribute("data-idx"));';
  html += '      var rec = records[idx];';
  html += '      var newStat = document.getElementById("status_" + idx).value;';
  html += '      var rem = document.getElementById("rem_" + idx).value;';
  html += '      var rejReason = newStat === "Rejected" ? rem : "";';
  html += '      updates.push({';
  html += '        rowIndex: rec.rowIndex,';
  html += '        invoiceNumber: rec.invoiceNumber,';
  html += '        vendorName: rec.vendorName,';
  html += '        approvalStatus: newStat,';
  html += '        approverName: approver,';
  html += '        rejectionReason: rejReason,';
  html += '        remarks: rem';
  html += '      });';
  html += '    }';
  html += '  });';
  html += '  if (updates.length === 0) {';
  html += '    alert("Please select at least one invoice to submit.");';
  html += '    return;';
  html += '  }';
  html += '  document.getElementById("submitBtn").disabled = true;';
  html += '  document.getElementById("spinner").style.display = "inline";';
  html += '  google.script.run';
  html += '    .withSuccessHandler(function(res) {';
  html += '       alert(res.message || "Review batch updated successfully!");';
  html += '       google.script.host.close();';
  html += '     })';
  html += '    .withFailureHandler(function(err) {';
  html += '       alert("Failed to submit batch: " + err);';
  html += '       document.getElementById("submitBtn").disabled = false;';
  html += '       document.getElementById("spinner").style.display = "none";';
  html += '     })';
  html += '    .submitReviewBatch(updates);';
  html += '}';

  html += 'renderTable();';
  html += '</script></body></html>';

  return html;
}

// =======================================================================
// Export Approved to Tally (Excel CSV)
// =======================================================================

function exportApprovedToTally() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getSheetByGid(ss, INVOICE_DATABASE_GID) || ss.getActiveSheet();
  var lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    SpreadsheetApp.getUi().alert("No invoice records found in sheet.");
    return;
  }

  var lastCol = Math.min(sheet.getLastColumn(), 24);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  var colIdx = {};
  for (var i = 0; i < headers.length; i++) {
    colIdx[headers[i].trim()] = i;
  }

  if (colIdx["Approval Status"] === undefined) {
    SpreadsheetApp.getUi().alert("Could not find 'Approval Status' column. Please run 'Setup Invoice Sheet Headers' first.");
    return;
  }

  var approvedData = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var status = row[colIdx["Approval Status"]];
    if (status && String(status).trim().toLowerCase() === "approved") {
      var item = {};
      for (var key in colIdx) {
        item[key] = row[colIdx[key]];
      }
      approvedData.push(item);
    }
  }

  if (approvedData.length === 0) {
    SpreadsheetApp.getUi().alert("No entries with 'Approved' status found to export!");
    return;
  }

  var csvContent = generateTallyCSV(approvedData);
  var base64Csv = Utilities.base64Encode(csvContent, Utilities.Charset.UTF_8);

  var html = "<div style='font-family:sans-serif;padding:10px;'>" +
    "<h3 style='color:#0F2942;margin-top:0;'>Tally Export Ready</h3>" +
    "<p>Found <b>" + approvedData.length + "</b> approved purchase entries.</p>" +
    "<a href='data:text/csv;charset=utf-8;base64," + base64Csv + "' download='Tally_Purchase_Register.csv' style='display:inline-block;padding:10px 18px;background:#10B981;color:white;text-decoration:none;border-radius:6px;font-weight:bold;margin-bottom:10px;'>Download CSV for Tally</a>" +
    "<p style='color:#6B7280;font-size:11px;margin:0;'>This file can be opened directly in Microsoft Excel and imported into Tally.</p>" +
    "</div>";

  var userInterface = HtmlService.createHtmlOutput(html)
    .setWidth(360)
    .setHeight(180);

  SpreadsheetApp.getUi().showModalDialog(userInterface, 'PKC Management Consulting - Tally Export');
}

function generateTallyCSV(data) {
  var tallyHeaders = [
    "Voucher Date", "Voucher No", "Voucher Type", "Ref No", "Ref Date",
    "Party Ledger Name", "GSTIN/UIN", "Expense Ledger", "Purchase Value (Taxable Amount)",
    "CGST Amount", "SGST Amount", "IGST Amount", "Total Amount", "Narration"
  ];

  var rows = [tallyHeaders.join(",")];

  for (var i = 0; i < data.length; i++) {
    var r = data[i];

    var dateVal = r["Invoice Date"] || r["Timestamp"] || "";
    var dateStr = "";
    if (dateVal) {
      if (dateVal instanceof Date) {
        dateStr = Utilities.formatDate(dateVal, Session.getScriptTimeZone(), "yyyy-MM-dd");
      } else {
        dateStr = String(dateVal).split("T")[0];
      }
    }

    var voucherNo = r["Invoice Number"] || "";
    var partyName = r["Vendor Name"] || "Cash/General Vendor";
    var gstin = r["Vendor GSTIN"] || "";
    var expenseLedger = r["Expense Category"] || "Purchase Account";
    var taxable = parseFloat(r["Taxable Amount"] || 0);
    var cgst = parseFloat(r["CGST"] || 0);
    var sgst = parseFloat(r["SGST"] || 0);
    var igst = parseFloat(r["IGST"] || 0);
    var total = parseFloat(r["Total Amount"] || 0);
    var narration = "Tally import from PKC Management Consulting AP OCR. Ref Invoice No: " + voucherNo + ". Remarks: " + (r["Remarks"] || "");

    var row = [
      escapeCsv(dateStr),
      escapeCsv(voucherNo),
      "Purchase",
      escapeCsv(voucherNo),
      escapeCsv(dateStr),
      escapeCsv(partyName),
      escapeCsv(gstin),
      escapeCsv(expenseLedger),
      taxable.toFixed(2),
      cgst.toFixed(2),
      sgst.toFixed(2),
      igst.toFixed(2),
      total.toFixed(2),
      escapeCsv(narration)
    ];

    rows.push(row.join(","));
  }

  return rows.join("\r\n");
}

function escapeCsv(val) {
  if (val === null || val === undefined) return "";
  var str = String(val).replace(/"/g, '""');
  if (str.indexOf(",") !== -1 || str.indexOf("\n") !== -1 || str.indexOf('"') !== -1) {
    return '"' + str + '"';
  }
  return str;
}

// =======================================================================
// AP Invoice Database Webhook — Google Sheet Persistence
// =======================================================================

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var dbSheet = getSheetByGid(ss, INVOICE_DATABASE_GID) || ss.getSheets()[0];
    var data = readSheetData(dbSheet);
    return jsonResponse(data);
  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}

function doPost(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var dbSheet = getSheetByGid(ss, INVOICE_DATABASE_GID);

    if (!dbSheet) {
      return jsonResponse({ status: "error", message: "Invoice Database sheet (GID " + INVOICE_DATABASE_GID + ") not found." });
    }

    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }

    var action = body.action || (e && e.parameter ? e.parameter.action : "");

    if (action === "clear_all" || action === "flushDatabase" || action === "clear_database" || action === "flush") {
      // Clear content strictly across Columns A through X (rows 2 to 1000).
      // Do NOT delete structural rows so formulas in Columns Y and Z remain intact.
      dbSheet.getRange(2, 1, 1000, 24).clearContent();
      var itemSheetToClear = getSheetByGid(ss, ITEM_DATABASE_GID);
      if (itemSheetToClear) {
        itemSheetToClear.getRange(2, 1, 1000, 24).clearContent();
      }
      return jsonResponse({ status: "success", message: "Database sheet cleared successfully." });
    }

    if (action === "submitReviewBatch" || action === "submit_review_batch") {
      var updates = body.updates || body.items || body.invoices || body;
      var reviewRes = submitReviewBatch(updates);
      return jsonResponse(reviewRes);
    }

    if (dbSheet.getLastRow() === 0) {
      var invoiceHeaders = INVOICE_HEADERS;
      dbSheet.getRange(1, 1, 1, invoiceHeaders.length).setValues([invoiceHeaders]);
      var invoiceHeaderRange = dbSheet.getRange(1, 1, 1, invoiceHeaders.length);
      invoiceHeaderRange.setFontWeight("bold");
      invoiceHeaderRange.setBackground("#0F2942");
      invoiceHeaderRange.setFontColor("#FFFFFF");

      var approvalCell = dbSheet.getRange("T2:T5000");
      var approvalRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(["Pending L1", "Pending L2", "Approved", "Rejected"], true)
        .build();
      approvalCell.setDataValidation(approvalRule);
    }

    var rowsToAppend = [];
    if (Array.isArray(body)) {
      rowsToAppend = body;
    } else if (body.invoices && Array.isArray(body.invoices)) {
      rowsToAppend = body.invoices;
    } else {
      rowsToAppend = [body];
    }

    var maxCheckRows = 1000;
    var existingValues = dbSheet.getRange(2, 1, maxCheckRows, 24).getValues();

    var appendedCount = 0;
    var updatedCount = 0;

    for (var i = 0; i < rowsToAppend.length; i++) {
      var item = rowsToAppend[i];
      var invNo = String(item.invoice_no || item.invoice_number || "").trim().toLowerCase();
      var vendor = String(item.merchant || item.vendor_name || "").trim().toLowerCase();
      var gstin = String(item.vendor_tax_id || item.gstin || "").trim().toLowerCase();
      var cleanInv = invNo.replace(/[^a-z0-9]/g, "");

      // Default all newly inserted or matched records to "Pending L1"
      var rawStatus = String(item.approval_status || "").trim();
      var approvalStatus = "Pending L1";
      if (rawStatus && rawStatus.toLowerCase() !== "pending") {
        approvalStatus = rawStatus;
      }

      var discVal = (item.discount_amount !== undefined && item.discount_amount !== null && item.discount_amount !== "") ? Number(item.discount_amount) : 0.0;
      if (discVal && !isNaN(discVal) && discVal > 0) {
        discVal = -Math.abs(discVal);
      }

      var row = [
        item.timestamp || new Date().toISOString(),                        // A Timestamp (Col 1)
        item.file_name || "",                                              // B File Name (Col 2)
        item.merchant || item.vendor_name || "",                          // C Vendor Name (Col 3)
        item.date || item.invoice_date || "",                             // D Invoice Date (Col 4)
        item.category || "",                                              // E Expense Category (Col 5)
        item.invoice_no || item.invoice_number || "",                     // F Invoice Number (Col 6)
        item.vendor_tax_id || item.gstin || "",                           // G Vendor GSTIN (Col 7)
        item.taxable_amount || "",                                        // H Taxable Amount (Col 8)
        item.cgst || "",                                                  // I CGST (Col 9)
        item.sgst || "",                                                  // J SGST (Col 10)
        item.igst || "",                                                  // K IGST (Col 11)
        (item.cess !== undefined && item.cess !== null) ? item.cess : 0.0, // L Cess (Col 12)
        discVal,                                                           // M Discount (Col 13)
        (item.round_off_amount !== undefined && item.round_off_amount !== null) ? item.round_off_amount : 0.0, // N Round Off (Col 14)
        (item.additional_charges_amount !== undefined && item.additional_charges_amount !== null) ? item.additional_charges_amount : 0.0, // O Additional Charges (Col 15)
        item.total || item.total_amount || "",                           // P Total Amount (Col 16)
        item.due_date || "",                                              // Q Due Date (Col 17)
        item.confidence || item.overall_confidence || "",                // R Confidence (Col 18)
        "",                                                                // S Tally Ledger Name (Col 19)
        approvalStatus,                                                    // T Approval Status (Col 20)
        "",                                                                // U Approver Name (Col 21)
        "",                                                                // V Approval Date (Col 22)
        "",                                                                // W Rejection Reason (Col 23)
        item.remarks || item.extraction_notes || ""                      // X Remarks (Col 24)
      ];

      // Strict enforcement: row length must be exactly 24 (Columns A through X)
      var row24 = row.slice(0, 24);
      while (row24.length < 24) row24.push("");

      var matchRowIdx = -1;
      if (cleanInv.length > 0 && existingValues.length > 0) {
        for (var r = 0; r < existingValues.length; r++) {
          var exInv = String(existingValues[r][5] || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
          if (!exInv) continue;

          var exVendor = String(existingValues[r][2] || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
          var exGstin = String(existingValues[r][6] || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

          if (exInv === cleanInv) {
            var cleanGstin = gstin.replace(/[^a-z0-9]/g, "");
            var cleanVendor = vendor.replace(/[^a-z0-9]/g, "");
            var gstinMatch = cleanGstin.length > 0 && exGstin.length > 0 && exGstin === cleanGstin;
            var vendorMatch = cleanVendor.length > 0 && exVendor.length > 0 && exVendor === cleanVendor;
            if (gstinMatch || vendorMatch) {
              matchRowIdx = r + 2;
              break;
            }
          }
        }
      }

      // Restrict database write ranges strictly to Columns A through X (columns 1 to 24).
      // NEVER write past Column X so formulas in Column Y (Processing Days) and Column Z (Status) remain untouched.
      if (matchRowIdx > 0) {
        dbSheet.getRange(matchRowIdx, 1, 1, 24).setValues([row24]);
        updatedCount++;
      } else {
        var targetRow = findFirstAvailableRow(dbSheet);
        dbSheet.getRange(targetRow, 1, 1, 24).setValues([row24]);
        appendedCount++;
      }

      if (item.line_items && Array.isArray(item.line_items) && item.line_items.length > 0) {
        item.approval_status = approvalStatus;
        writeLineItemsToItemSheet(ss, item);
      }
    }

    return jsonResponse({
      status: "success",
      message: "Synced " + (appendedCount + updatedCount) + " AP Invoice row(s) to Database sheet (" + updatedCount + " updated, " + appendedCount + " new).",
      appended: appendedCount,
      updated: updatedCount
    });

  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}

// =======================================================================
// Item-wise Database Write — GID-targeted line item persistence
// =======================================================================

function writeLineItemsToItemSheet(ss, body) {
  var itemSheet = getSheetByGid(ss, ITEM_DATABASE_GID);
  if (!itemSheet) return;

  var itemHeaders = ITEM_HEADERS;

  if (itemSheet.getLastRow() === 0) {
    itemSheet.getRange(1, 1, 1, itemHeaders.length).setValues([itemHeaders]);
    var itemHeaderRange = itemSheet.getRange(1, 1, 1, itemHeaders.length);
    itemHeaderRange.setFontWeight("bold");
    itemHeaderRange.setBackground("#0F2942");
    itemHeaderRange.setFontColor("#FFFFFF");

    // Line Type validation dropdown in Col E (column 5)
    var lineTypeRange = itemSheet.getRange("E2:E5000");
    var lineTypeRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(["Stock Item", "Service", "Additional Charge", "Discount", "Round Off"], true)
      .build();
    lineTypeRange.setDataValidation(lineTypeRule);

    // Approval Status dropdown in Col U (column 21)
    var approvalCell = itemSheet.getRange("U2:U5000");
    var approvalRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(["Pending L1", "Pending L2", "Approved", "Rejected"], true)
      .build();
    approvalCell.setDataValidation(approvalRule);
  }

  var invoiceNo = String(body.invoice_no || body.invoice_number || "").trim();
  var vendorName = String(body.merchant || body.vendor_name || "").trim();

  // Deduplication: remove any prior item rows for this Invoice Number + Vendor Name
  var lastRow = itemSheet.getLastRow();
  if (lastRow > 1) {
    var existing = itemSheet.getRange(2, 1, lastRow - 1, 24).getValues();
    var rowsToDelete = [];
    for (var r = 0; r < existing.length; r++) {
      var exInvoiceNo = String(existing[r][1] || "").trim();
      var exVendorName = String(existing[r][2] || "").trim();
      if (exInvoiceNo === invoiceNo && exVendorName === vendorName) {
        rowsToDelete.push(r + 2);
      }
    }
    for (var d = rowsToDelete.length - 1; d >= 0; d--) {
      itemSheet.deleteRow(rowsToDelete[d]);
    }
  }

  var timestamp = body.timestamp || new Date().toISOString();
  var invoiceDate = body.date || body.invoice_date || "";
  var approvalStatus = body.approval_status || "Pending L1";

  var newRows = [];
  for (var i = 0; i < body.line_items.length; i++) {
    var li = body.line_items[i];
    var lineType = li.line_type || li.classification || li.item_type || "Stock Item";
    var itemDesc = li.description || li.item_name || "";

    // Discount Polarity Inversion:
    // Identify discount rows and invert Unit Price, Taxable Amount, Line Total to strictly negative.
    var isDiscount = String(lineType).trim().toLowerCase() === "discount" ||
      String(itemDesc).trim().toLowerCase().indexOf("discount") !== -1 ||
      String(li.classification || "").trim().toLowerCase() === "discount";

    if (isDiscount) {
      lineType = "Discount";
      if (!itemDesc.trim()) itemDesc = "Discount";
    }

    var qty = (li.quantity !== null && li.quantity !== undefined && li.quantity !== "") ? li.quantity : (isDiscount ? 1 : "");

    var unitPrice = (li.unit_price !== null && li.unit_price !== undefined && li.unit_price !== "") ? li.unit_price : "";
    var taxableAmount = (li.taxable_amount !== null && li.taxable_amount !== undefined && li.taxable_amount !== "") ? li.taxable_amount : ((li.taxable_value !== null && li.taxable_value !== undefined && li.taxable_value !== "") ? li.taxable_value : "");
    var lineTotal = (li.line_total !== null && li.line_total !== undefined && li.line_total !== "") ? li.line_total : ((li.total_amount !== null && li.total_amount !== undefined && li.total_amount !== "") ? li.total_amount : "");

    if (isDiscount) {
      if (unitPrice !== "" && !isNaN(Number(unitPrice))) {
        unitPrice = -Math.abs(Number(unitPrice));
      }
      if (taxableAmount !== "" && !isNaN(Number(taxableAmount))) {
        taxableAmount = -Math.abs(Number(taxableAmount));
      }
      if (lineTotal !== "" && !isNaN(Number(lineTotal))) {
        lineTotal = -Math.abs(Number(lineTotal));
      }
    }

    var cgstAmt = (li.cgst !== null && li.cgst !== undefined) ? li.cgst : (li.cgst_amount || 0.0);
    var sgstAmt = (li.sgst !== null && li.sgst !== undefined) ? li.sgst : (li.sgst_amount || 0.0);
    var igstAmt = (li.igst !== null && li.igst !== undefined) ? li.igst : (li.igst_amount || 0.0);
    var cessAmt = (li.cess !== null && li.cess !== undefined) ? li.cess : 0.0;
    var discountAmt = (li.discount_amount !== null && li.discount_amount !== undefined) ? li.discount_amount : 0.0;

    if (isDiscount) {
      if (cgstAmt && !isNaN(Number(cgstAmt)) && Number(cgstAmt) !== 0) cgstAmt = -Math.abs(Number(cgstAmt));
      if (sgstAmt && !isNaN(Number(sgstAmt)) && Number(sgstAmt) !== 0) sgstAmt = -Math.abs(Number(sgstAmt));
      if (igstAmt && !isNaN(Number(igstAmt)) && Number(igstAmt) !== 0) igstAmt = -Math.abs(Number(igstAmt));
      if (cessAmt && !isNaN(Number(cessAmt)) && Number(cessAmt) !== 0) cessAmt = -Math.abs(Number(cessAmt));
    }

    var rowItem = [
      timestamp,                                                          // A Timestamp (Col 1)
      invoiceNo,                                                          // B Invoice Number (Col 2)
      vendorName,                                                         // C Vendor Name (Col 3)
      invoiceDate,                                                        // D Invoice Date (Col 4)
      lineType,                                                           // E Line Type (Col 5)
      itemDesc,                                                           // F Item Description (Col 6)
      li.hsn_sac || "",                                                   // G HSN/SAC (Col 7)
      qty,                                                                // H Quantity (Col 8)
      li.unit || "",                                                      // I Unit (Col 9)
      unitPrice,                                                          // J Unit Price (Col 10)
      taxableAmount,                                                      // K Taxable Amount (Col 11)
      (li.tax_rate_percent !== null && li.tax_rate_percent !== undefined) ? li.tax_rate_percent : "", // L Tax Rate (%) (Col 12)
      cgstAmt,                                                            // M CGST Amount (Col 13)
      sgstAmt,                                                            // N SGST Amount (Col 14)
      igstAmt,                                                            // O IGST Amount (Col 15)
      cessAmt,                                                            // P Cess Amount (Col 16)
      discountAmt,                                                        // Q Discount Amount (Col 17)
      lineTotal,                                                          // R Line Total (Col 18)
      "",                                                                  // S Supplier Ledger Name (Col 19)
      "",                                                                  // T Mapped Tally Stock Item (Col 20)
      approvalStatus,                                                     // U Approval Status (Col 21)
      "",                                                                  // V Approver Name (Col 22)
      "",                                                                  // W Approval Date (Col 23)
      ""                                                                   // X Rejection Reason (Col 24)
    ];

    var rowItem24 = rowItem.slice(0, 24);
    while (rowItem24.length < 24) rowItem24.push("");
    newRows.push(rowItem24);
  }

  if (newRows.length > 0) {
    // Restrict write strictly to Columns A through X (columns 1 to 24).
    // Never write past Column X so formulas in Column Y and Column Z remain untouched.
    var startRow = findFirstAvailableRow(itemSheet);
    itemSheet.getRange(startRow, 1, newRows.length, 24).setValues(newRows);
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function readSheetData(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  // Strictly read columns 1 through 24 (A to X)
  var headers = sheet.getRange(1, 1, 1, 24).getValues()[0];
  var values = sheet.getRange(2, 1, lastRow - 1, 24).getValues();

  var list = [];
  for (var r = 0; r < values.length; r++) {
    var item = {};
    for (var c = 0; c < 24; c++) {
      var val = values[r][c];
      if (val instanceof Date) {
        val = val.toISOString();
      }
      item[headers[c]] = val;
    }
    list.push(item);
  }
  return list;
}

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var dbSheet = getSheetByGid(ss, INVOICE_DATABASE_GID);
    if (!dbSheet) {
      return jsonResponse([]);
    }
    return jsonResponse(readSheetData(dbSheet));
  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}