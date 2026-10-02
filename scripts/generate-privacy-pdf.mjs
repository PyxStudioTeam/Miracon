import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const LOGO_SVG = `
<svg width="36" height="29" viewBox="0 0 47 38" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M33.6402 18.2754C34.1992 16.3714 34.8717 14.5023 35.5967 12.6506C35.9024 11.8733 36.1993 11.0785 36.5749 10.3361C37.0902 9.32289 37.1339 8.20492 37.4134 7.13935C38.3305 3.55834 40.5926 1.22631 44.0863 0.0734041C44.2348 0.0297332 44.4269 -0.0576085 44.5317 0.0559358C44.654 0.178214 44.5492 0.370366 44.5143 0.536315C43.8155 3.72429 41.8853 6.05631 39.3436 7.96036C39.2825 8.00403 39.2301 8.0477 39.169 8.08264C37.9374 8.75517 37.2998 9.83821 36.9068 11.1396C36.6535 11.9781 36.2954 12.7816 35.9548 13.655C36.1906 13.6288 36.243 13.4629 36.3304 13.3581C37.4833 11.9169 38.6973 10.5544 40.2869 9.56745C42.0774 8.45821 43.9815 7.82935 46.1126 8.0215C46.2698 8.03897 46.4271 8.06517 46.5755 8.09137C47.0472 8.17872 47.1258 8.40872 46.8114 8.78137C45.0471 10.8863 42.8024 12.275 40.2345 13.2009C39.2301 13.559 38.1733 13.7337 37.2038 14.1878C36.8981 14.3276 36.6011 14.5023 36.3042 14.6682C35.5705 15.0787 35.1949 15.725 34.9853 16.5199C34.5486 18.2143 34.0857 19.8912 33.6315 21.5769C33.6315 21.5944 33.649 21.6293 33.6577 21.6643C33.8848 21.6643 33.9023 21.4547 33.9809 21.3324C35.3783 19.1488 37.0553 17.2448 39.3786 15.9871C41.0468 15.0874 42.8111 14.6682 44.6977 14.7119C44.7588 14.7119 44.8112 14.7119 44.8724 14.7206C45.2829 14.773 45.3178 14.8342 45.0907 15.1835C43.9466 16.9653 42.4006 18.3278 40.645 19.4807C39.1864 20.4328 37.5531 20.9655 35.9548 21.6031C35.3871 21.8302 34.8368 22.101 34.3302 22.4416C33.7363 22.8347 33.3258 23.3412 33.1599 24.0487C32.7581 25.7606 32.3388 27.4638 31.9283 29.1844C32.1642 29.1844 32.1904 29.001 32.269 28.8874C33.2909 27.324 34.3652 25.8043 35.8325 24.6077C37.4483 23.2801 39.2738 22.4242 41.3612 22.1621C42.0949 22.066 42.8024 22.1185 43.5273 22.1971C43.9378 22.2407 43.8854 22.3717 43.7107 22.6425C42.4181 24.6252 40.7236 26.1624 38.6536 27.3153C37.1688 28.145 35.5617 28.6603 33.9809 29.2543C33.745 29.3416 33.5092 29.4552 33.2734 29.5512C32.1292 30.0054 31.4305 30.8002 31.0986 32.023C30.6793 33.5428 29.9981 34.9752 29.2644 36.3726C29.1683 36.5473 29.0635 36.6521 28.8452 36.6783C28.2862 36.7395 27.7359 36.8268 27.0721 36.9141C27.7185 35.9883 28.3036 35.1673 28.8015 34.3026C30.0155 32.2152 30.9239 30.0054 31.448 27.6385C31.5964 26.9659 31.4217 26.3458 31.0636 25.7693C30.4261 24.73 29.6312 23.8216 28.8714 22.8871C27.5874 21.3149 26.8363 19.5244 26.5568 17.5155C26.4607 16.8255 26.3996 16.1355 26.3035 15.4455C26.2424 14.9914 26.452 15.0263 26.7228 15.1049C27.57 15.3495 28.3211 15.7687 28.9674 16.3714C30.6007 17.8999 31.5353 19.7777 31.7711 22.0049C31.8847 23.0879 31.8934 24.1623 31.7711 25.2366C31.7449 25.42 31.7187 25.6296 31.841 25.8742C32.103 25.4636 32.1205 25.0357 32.2166 24.6339C32.5397 23.2626 32.8018 21.8826 33.1336 20.5201C33.3258 19.7253 33.221 18.9916 32.9153 18.2405C32.1729 16.4063 31.4654 14.5547 31.2995 12.5633C31.1073 10.3535 31.4043 8.22239 32.6009 6.29213C32.8978 5.82049 32.9415 5.82922 33.2297 6.31834C33.7974 7.3053 34.0595 8.39707 34.2254 9.51504C34.435 10.93 34.435 12.3537 34.3215 13.7686C34.2254 14.9302 33.9721 16.0657 33.6839 17.1924C33.5966 17.5505 33.518 17.8999 33.6577 18.2754H33.6402Z" fill="#111827"/>
<path d="M18.7396 5.7071C22.7661 5.7071 26.8013 5.7071 30.8277 5.7071C31.3343 5.7071 31.3343 5.7071 31.0897 6.13508C30.8277 6.58925 30.5919 7.06963 30.4434 7.56748C30.3299 7.92558 30.1377 8.00419 29.7971 8.00419C25.7095 7.98672 21.6219 7.96925 17.543 7.96925C14.1542 7.96925 10.7653 7.96925 7.37645 8.04786C4.55532 8.109 2.60759 10.0567 2.54646 12.808C2.51152 14.4849 2.9919 15.9086 4.49418 16.8082C5.7519 17.5681 7.11443 17.7603 8.48569 17.1227C10.3635 16.258 10.8439 13.5155 9.37658 12.1879C8.52937 11.4193 7.11443 11.4717 6.42443 12.2927C6.02266 12.7731 5.97899 13.4194 6.32835 13.8212C6.67772 14.2229 7.00962 14.1705 7.20177 13.6989C7.35025 13.3408 7.71709 13.1399 8.10139 13.2098C8.52063 13.2884 8.83506 13.6727 8.85253 14.1268C8.87873 14.7994 8.31101 15.5243 7.57734 15.7776C6.00519 16.3104 4.3457 15.2011 4.18848 13.5155C3.99633 11.4979 5.27152 9.95191 7.27164 9.59381C9.49012 9.20077 11.2108 10.3275 11.9008 11.69C13.0275 13.8998 12.5995 17.7253 9.42025 19.018C6.86114 20.0574 4.41557 19.7342 2.22329 18.0572C0.948101 17.0703 0.397848 15.6117 0.127089 14.0657C-0.239746 11.9957 0.188228 10.0655 1.40228 8.36229C2.48532 6.84255 3.98759 5.96913 5.87418 5.76824C7.28038 5.61976 8.68658 5.69837 10.1015 5.68963C12.9925 5.67217 15.8835 5.68963 18.7746 5.68963L18.7396 5.7071Z" fill="#111827"/>
<path d="M12.7917 28.3722C12.7917 25.3502 12.7917 22.3369 12.7829 19.3149C12.7829 18.9218 12.8878 18.8083 13.2808 18.8083C17.1937 18.8083 21.1153 18.7995 25.0283 18.7733C25.3165 18.7733 25.43 18.8519 25.5348 19.1402C25.989 20.3542 26.12 21.6032 26.0851 22.9046C26.024 24.73 26.0589 26.5468 26.0589 28.3722C26.0589 28.6517 25.989 28.8438 25.7445 29.0098C25.1156 29.429 24.5129 29.8832 23.8928 30.3112C23.7967 30.3811 23.6919 30.5383 23.5697 30.4684C23.4212 30.3898 23.4998 30.2064 23.4998 30.0754C23.4998 27.9966 23.4998 25.9179 23.4998 23.8392C23.4998 23.1666 23.4998 22.5028 23.4998 21.8303C23.491 20.9394 22.9059 20.3018 22.1198 20.3018C21.29 20.3018 20.6961 20.9481 20.6961 21.839C20.6961 25.2541 20.6961 28.6779 20.6961 32.093C20.6961 32.4161 20.6088 32.617 20.338 32.8004C19.6742 33.2459 19.0279 33.7088 18.3728 34.163C18.2942 34.2154 18.2331 34.3376 18.1195 34.2678C18.0147 34.2066 18.0584 34.0843 18.0584 33.997C18.0584 33.2546 18.0584 32.5122 18.0584 31.7785C18.0584 28.5207 18.0584 25.2541 18.0409 21.9963C18.0409 20.9219 17.3859 20.2319 16.4513 20.3106C15.6914 20.3717 15.1936 20.9744 15.1848 21.8565C15.1848 23.1666 15.1848 24.4768 15.1848 25.7869C15.1848 29.0884 15.1848 32.3987 15.1936 35.7002C15.1936 36.0932 15.0975 36.3552 14.7481 36.5736C14.1979 36.923 13.6738 37.3247 13.141 37.6916C13.0537 37.7527 12.9751 37.8837 12.8528 37.8226C12.7305 37.7614 12.7917 37.613 12.7917 37.5081C12.7917 34.818 12.7917 32.1279 12.7917 29.4378C12.7917 29.0797 12.7917 28.7216 12.7917 28.3722Z" fill="#111827"/>
<path d="M18.4948 1.21746C23.6217 1.21746 28.7487 1.21746 33.8756 1.21746C33.9717 1.21746 34.0765 1.21746 34.1726 1.21746C34.4084 1.21746 34.4084 1.3048 34.2774 1.47075C33.6311 2.24809 33.0634 3.08657 32.6179 3.99492C32.4956 4.24822 32.2948 4.23075 32.0764 4.23075C29.1417 4.23075 26.207 4.23075 23.2811 4.23075C17.3593 4.23075 11.4375 4.23075 5.50705 4.23075C5.18388 4.23075 4.93932 4.18708 4.77338 3.87265C4.58996 3.53201 4.24059 3.3748 3.90869 3.20885C3.27983 2.91189 2.82565 2.44024 2.6073 1.76771C2.45882 1.29607 2.51122 1.21746 3.00034 1.21746C8.17097 1.21746 13.3416 1.21746 18.5035 1.21746H18.4948Z" fill="#111827"/>
<path d="M12.4165 10.0569C12.5999 9.9259 12.7484 9.96957 12.8794 9.96957C18.3907 9.96957 23.8932 9.96957 29.4045 9.96084C29.7538 9.96084 29.8848 10.0394 29.8412 10.4063C29.7276 11.402 29.78 12.3977 29.7888 13.3934C29.7888 13.6903 29.7014 13.7777 29.4045 13.7777C24.3561 13.7777 19.299 13.7951 14.2507 13.8126C13.9624 13.8126 13.8576 13.7427 13.8402 13.437C13.779 12.1531 13.4471 10.974 12.4165 10.0482V10.0569Z" fill="#111827"/>
<path d="M18.958 17.6992C17.0627 17.6992 15.1761 17.6992 13.2808 17.6992C13.1585 17.6992 13.0013 17.7603 12.9227 17.638C12.8354 17.507 13.0013 17.4109 13.0625 17.3149C13.3158 16.8869 13.5079 16.424 13.6302 15.9436C13.6913 15.7078 13.7874 15.6117 14.032 15.6117C17.5344 15.6117 21.0368 15.6117 24.5304 15.6117C24.7575 15.6117 24.8449 15.6903 24.8711 15.9261C24.9147 16.3803 24.9497 16.8345 25.0807 17.2712C25.1768 17.5944 25.0982 17.7254 24.7226 17.7166C22.8011 17.6992 20.8796 17.7166 18.958 17.7166V17.6992Z" fill="#111827"/>
</svg>
`;

function buildHtml(data) {
  return `<!DOCTYPE html>
<html lang="${data.lang}">
<head>
  <meta charset="UTF-8">
  <title>${data.title}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 18mm 18mm 20mm 18mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: 'Times New Roman', Times, Georgia, serif;
      font-size: 9.5pt;
      line-height: 1.5;
      color: #111111;
      background: #ffffff;
      margin: 0;
      padding: 0;
    }

    /* Executive Letterhead */
    .letterhead {
      margin-bottom: 12pt;
    }
    .letterhead-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      padding-bottom: 6pt;
    }
    .letterhead-brand {
      display: flex;
      align-items: center;
      gap: 12pt;
    }
    .company-title {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 15pt;
      font-weight: bold;
      letter-spacing: 0.12em;
      color: #000000;
      line-height: 1;
      margin: 0;
    }
    .company-sub {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 7.2pt;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #444444;
      margin: 3pt 0 0 0;
    }
    .letterhead-meta {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 7pt;
      line-height: 1.45;
      color: #333333;
      text-align: right;
    }
    .letterhead-meta strong {
      color: #000000;
    }
    .letterhead-rule {
      border-top: 1.5pt solid #000000;
      border-bottom: 0.5pt solid #000000;
      height: 2pt;
      margin-top: 4pt;
    }

    /* Document Title Block */
    .title-block {
      text-align: center;
      margin: 14pt 0 12pt 0;
    }
    .doc-title {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 12.5pt;
      font-weight: bold;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #000000;
      margin: 0 0 5pt 0;
      line-height: 1.25;
    }
    .doc-subtitle {
      font-size: 8.5pt;
      font-style: italic;
      color: #333333;
      line-height: 1.4;
      max-width: 92%;
      margin: 0 auto;
    }

    /* Statutory Controller Identification Schedule */
    .id-table {
      width: 100%;
      border-collapse: collapse;
      border-top: 1pt solid #000000;
      border-bottom: 1pt solid #000000;
      margin: 10pt 0 14pt 0;
      font-size: 8pt;
      line-height: 1.4;
    }
    .id-table th {
      text-align: left;
      vertical-align: top;
      font-weight: bold;
      color: #000000;
      padding: 4pt 6pt 4pt 0;
      font-size: 7.5pt;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      width: 22%;
    }
    .id-table td {
      vertical-align: top;
      padding: 4pt 8pt 4pt 0;
      color: #222222;
      width: 28%;
    }

    /* Summary Schedule Table (Booktabs Style) */
    .schedule-block {
      margin: 12pt 0 14pt 0;
      break-inside: avoid;
    }
    .schedule-title {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 8.5pt;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: #000000;
      margin: 0 0 4pt 0;
    }
    .schedule-table {
      width: 100%;
      border-collapse: collapse;
      border-top: 1.25pt solid #000000;
      border-bottom: 1.25pt solid #000000;
      font-size: 7.8pt;
      line-height: 1.35;
    }
    .schedule-table th {
      background-color: #f5f5f5;
      color: #000000;
      text-align: left;
      padding: 4.5pt 5pt;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      border-bottom: 0.75pt solid #000000;
      font-size: 7.2pt;
    }
    .schedule-table td {
      padding: 4pt 5pt;
      border-bottom: 0.5pt solid #dddddd;
      vertical-align: top;
      color: #111111;
    }
    .schedule-table tr:last-child td {
      border-bottom: none;
    }

    /* Clauses and Numbered Articles */
    .article-section {
      margin-top: 11pt;
      margin-bottom: 11pt;
      break-inside: avoid;
    }
    .article-header {
      border-bottom: 0.75pt solid #000000;
      padding-bottom: 2pt;
      margin-bottom: 5pt;
      break-after: avoid;
    }
    .article-title {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 9.5pt;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: #000000;
      margin: 0;
    }
    .article-body p {
      margin: 0 0 5pt 0;
      text-align: justify;
      text-justify: inter-word;
      font-size: 9pt;
      line-height: 1.45;
      color: #111111;
    }
    .article-body p strong {
      color: #000000;
    }

    /* Sub-clauses */
    .sub-clause {
      margin-top: 5pt;
      margin-bottom: 5pt;
    }
    .sub-clause-title {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 9pt;
      font-weight: bold;
      color: #000000;
      margin-bottom: 2pt;
    }

    /* Lists */
    .legal-list {
      margin: 3pt 0 6pt 16pt;
      padding: 0;
      list-style-type: disc;
    }
    .legal-list li {
      margin-bottom: 2.5pt;
      font-size: 8.8pt;
      line-height: 1.42;
      color: #111111;
      text-align: justify;
      text-justify: inter-word;
    }

    /* Formal Covenant / Legal Stipulation Box */
    .legal-stipulation {
      border-left: 2pt solid #000000;
      border-top: 0.5pt solid #cccccc;
      border-right: 0.5pt solid #cccccc;
      border-bottom: 0.5pt solid #cccccc;
      background-color: #fafafa;
      padding: 5pt 8pt;
      margin: 6pt 0;
      font-size: 8.5pt;
      line-height: 1.45;
      color: #111111;
      text-align: justify;
    }

    /* Closing Sign-off & Supervisory Authority Schedule */
    .closing-block {
      margin-top: 14pt;
      border-top: 1pt solid #000000;
      padding-top: 8pt;
      break-inside: avoid;
    }
    .closing-title {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 9.5pt;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: #000000;
      margin: 0 0 6pt 0;
    }
    .closing-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16pt;
      font-size: 8.2pt;
      line-height: 1.45;
      color: #222222;
    }
    .closing-col strong {
      color: #000000;
      font-size: 8.5pt;
    }
    .closing-col a {
      color: #000000;
      text-decoration: underline;
    }
  </style>
</head>
<body>

  <!-- Formal Letterhead -->
  <header class="letterhead">
    <div class="letterhead-top">
      <div class="letterhead-brand">
        ${LOGO_SVG}
        <div>
          <h2 class="company-title">MIRACON</h2>
          <p class="company-sub">${data.brandSubtitle}</p>
        </div>
      </div>
      <div class="letterhead-meta">
        <div><strong>DOC REF:</strong> ${data.docRef}</div>
        <div><strong>DATE:</strong> ${data.effectiveDate}</div>
        <div><strong>LEGAL BASIS:</strong> ${data.legalBasisShort}</div>
      </div>
    </div>
    <div class="letterhead-rule"></div>
  </header>

  <!-- Document Title & Preamble -->
  <div class="title-block">
    <h1 class="doc-title">${data.docTitle}</h1>
    <div class="doc-subtitle">${data.docDesc}</div>
  </div>

  <!-- Statutory Controller Identification Schedule -->
  <table class="id-table">
    <tbody>
      <tr>
        <th>${data.lblController}:</th>
        <td><strong>MIRACON Single-Member P.C.</strong><br>${data.legalRep}</td>
        <th>${data.lblSeat}:</th>
        <td>${data.addressVal}<br>ΑΦΜ: 802235911 &middot; GEMI: 172901704000</td>
      </tr>
      <tr>
        <th>${data.lblInquiries}:</th>
        <td>info@miracon.gr &middot; +30 695 534 0416<br>miracon.gr</td>
        <th>${data.lblJurisdiction}:</th>
        <td>${data.jurisdictionVal}<br>Web: dpa.gr &middot; complaints@dpa.gr</td>
      </tr>
    </tbody>
  </table>

  <!-- Schedule A: Layered Processing Overview Matrix -->
  <div class="schedule-block">
    <div class="schedule-title">${data.summaryTitle}</div>
    <table class="schedule-table">
      <thead>
        <tr>
          <th style="width: 24%;">${data.colData}</th>
          <th style="width: 34%;">${data.colPurpose}</th>
          <th style="width: 22%;">${data.colLegalBasis}</th>
          <th style="width: 20%;">${data.colRetention}</th>
        </tr>
      </thead>
      <tbody>
        ${data.summaryRows.map(row => `
          <tr>
            <td><strong>${row[0]}</strong></td>
            <td>${row[1]}</td>
            <td>${row[2]}</td>
            <td>${row[3]}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <!-- Detailed Articles -->
  ${data.clauses.map(clause => `
    <div class="article-section">
      <div class="article-header">
        <h3 class="article-title">${clause.num}. ${clause.title}</h3>
      </div>
      <div class="article-body">
        ${clause.content}
      </div>
    </div>
  `).join('')}

  <!-- Closing Sign-off & Supervisory Authority Schedule -->
  <div class="closing-block">
    <div class="closing-title">${data.cardTitle}</div>
    <div class="closing-grid">
      <div class="closing-col">
        <strong>MIRACON Single-Member P.C.</strong><br>
        84 Egnatias Street, 54630 Thessaloniki, Greece<br>
        Tax Registration: 802235911 (A' D.O.Y. Thessalonikis)<br>
        General Commercial Registry (GEMI): 172901704000<br>
        Email: <a href="mailto:info@miracon.gr">info@miracon.gr</a> | Tel: +30 695 534 0416<br>
        Website: <a href="https://miracon.gr">https://miracon.gr</a>
      </div>
      <div class="closing-col">
        <strong>${data.supervisoryTitle}</strong><br>
        Hellenic Data Protection Authority (HDPA / ΑΠΔΠΧ)<br>
        Leoforos Kifisias 1-3, 115 23 Athens, Greece<br>
        Phone: +30 210 6475600 | Fax: +30 210 6475628<br>
        Email: <a href="mailto:complaints@dpa.gr">complaints@dpa.gr</a><br>
        Online Submissions Portal: <a href="https://www.dpa.gr">www.dpa.gr</a>
      </div>
    </div>
  </div>

</body>
</html>`;
}

// ENGLISH CONTENT DATA
const EN_DATA = {
  lang: 'en',
  title: 'Privacy Policy & Statutory Data Protection Notice — MIRACON',
  brandSubtitle: 'Single-Member P.C. · Thessaloniki, Greece',
  docRef: 'MC-LEG-GDPR-2026-V2',
  legalBasisShort: 'Regulation (EU) 2016/679 & Law 4624/2019',
  docTitle: 'PRIVACY POLICY & STATUTORY DATA PROTECTION NOTICE',
  docDesc: 'Drawn up in accordance with Articles 12, 13 and 14 of Regulation (EU) 2016/679 of the European Parliament and of the Council (General Data Protection Regulation — GDPR) and Hellenic Law 4624/2019.',
  lblDate: 'Effective Date',
  effectiveDate: '15 September 2026',
  lblVersion: 'Version',
  lblJurisdiction: 'Supervisory Authority',
  jurisdictionVal: 'Hellenic Data Protection Authority (HDPA)',
  lblController: 'Data Controller',
  legalRep: 'Legal Rep: Symeon Iosifidis, Manager',
  lblSeat: 'Registered Office & Tax ID',
  addressVal: '84 Egnatias Street, 54630 Thessaloniki, Greece',
  lblInquiries: 'Direct Inquiries & DPO',
  summaryTitle: 'SCHEDULE A: LAYERED DATA PROCESSING MATRIX (GDPR ARTICLES 13 & 14)',
  colData: 'Category of Data',
  colPurpose: 'Processing Purpose',
  colLegalBasis: 'Legal Basis (GDPR Art. 6)',
  colRetention: 'Statutory Retention Period',
  summaryRows: [
    ['Contact Form Enquiries', 'Responding to consultations, transmitting property specifications and pricing', 'Art. 6(1)(a) Consent & Art. 6(1)(b) Pre-contractual steps', '24 months from last communication, then erased'],
    ['Security & Anti-Abuse Telemetry', 'Defending forms against automated submission bots and CSRF vectors', 'Art. 6(1)(f) Legitimate interest in service integrity', 'Duration of browsing session only'],
    ['Server Technical Log Files', 'Network operations, diagnostics, prevention of intrusion and DDoS attacks', 'Art. 6(1)(f) Legitimate interest in operational resilience', 'Maximum 12 months in access-restricted storage'],
    ['Compliance & Legal Claims', 'Defense against civil claims, corporate accounting and tax law compliance', 'Art. 6(1)(c) Legal obligation & Art. 6(1)(f) Legal defense', 'Statutory limitation periods (Greek Civil Code)']
  ],
  cardTitle: '11. Corporate Sign-off & Supervisory Recourse Details',
  supervisoryTitle: 'Supervisory & Regulatory Recourse',
  clauses: [
    {
      num: '01',
      title: 'Data Controller & Statutory Identification',
      content: `
        <p>This website, <strong>miracon.gr</strong>, is owned and operated by <strong>MIRACON Single-Member Private Capital Company</strong> (Μονοπρόσωπη Ι.Κ.Ε.) (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;), a commercial entity duly incorporated under the laws of the Hellenic Republic, registered with the General Commercial Registry (GEMI) under number <strong>172901704000</strong>, with registered seat at <strong>84 Egnatias Street, 54630 Thessaloniki, Greece</strong>, legally represented by its Manager <strong>Symeon Iosifidis</strong>. Tax Registration Number (ΑΦΜ): <strong>802235911</strong> (A&rsquo; D.O.Y. Thessalonikis). We act as the Data Controller within the meaning of Article 4(7) of Regulation (EU) 2016/679 (GDPR).</p>
        <p>For any inquiries regarding this policy, or to exercise any statutory rights as a data subject, please direct correspondence to <strong>info@miracon.gr</strong>, by telephone at <strong>+30 695 534 0416</strong>, or by registered post to our corporate seat. In accordance with Article 37 GDPR, our processing activities do not meet mandatory criteria requiring the designation of a formal Data Protection Officer; direct oversight is retained by executive management.</p>
      `
    },
    {
      num: '02',
      title: 'Categories of Personal Data Processed',
      content: `
        <div class="sub-clause">
          <div class="sub-clause-title">2.1. Information Provided Directly by the Data Subject</div>
          <p>Through our digital consultation and contact forms, we collect the following personal identifiers: your full name; your telephone number and/or email address; the subject matter and narrative details of your enquiry; and the digital timestamp and audit record confirming your acceptance of this policy. Submission of these details is voluntary; however, provision of your name and at least one verifiable communication channel is strictly required to enable us to respond to your request.</p>
        </div>
        <div class="sub-clause">
          <div class="sub-clause-title">2.2. Technical Data Collected Automatically</div>
          <p>Upon accessing our website, our server infrastructure automatically captures standard HTTP protocol telemetry: client IP address, request timestamp, HTTP transmission method and destination URL, referrer header, user-agent identifier (browser engine, operating system, device class), and resultant HTTP response code.</p>
        </div>
        <div class="sub-clause">
          <div class="sub-clause-title">2.3. Cookies, Telemetry & Third-Party Technical Integrations</div>
          <p><strong>This website does not deploy first-party tracking, analytical, profiling, or marketing cookies.</strong> It functions without behavioral advertising trackers. To render architectural presentations and interactive project assets, specific third-party components receive your technical IP address during asset delivery:</p>
          <ul class="legal-list">
            <li><strong>Google Fonts & jsDelivr CDN:</strong> Typeface and style assets delivered to your browser to guarantee uniform typographic rendering.</li>
            <li><strong>Google Maps:</strong> Cartographic project coordinates embedded on property pages. Because maps initialize upon viewport scrolling, Google receives the client IP address. Project coordinates also provide outbound links to external Google Maps navigation services.</li>
            <li><strong>360° Virtual Walkthroughs & 3D Models:</strong> Embedded architectural tours hosted on Google Cloud Platform infrastructure (<em>storage.net-fs.com</em>) and 3D architectural representations via <em>sketchfab.com</em>, which process client IP addresses solely for multimedia streaming.</li>
          </ul>
        </div>
      `
    },
    {
      num: '03',
      title: 'Purposes of Processing and Lawful Bases (GDPR Article 6)',
      content: `
        <p>Personal data is processed strictly in accordance with Article 6 of Regulation (EU) 2016/679 under the following lawful grounds:</p>
        <ul class="legal-list">
          <li><strong>Enquiry Fulfillment & Property Advisory:</strong> To address enquiries, provide property specifications, price schedules, and coordinate on-site viewings — pursuant to your explicit consent (Art. 6(1)(a)) and actions taken at your request prior to entering into a contract (Art. 6(1)(b)).</li>
          <li><strong>Form Security & Anti-Abuse Defense:</strong> To prevent automated spam submissions, credential stuffing, and bot traffic via server-side verification — pursuant to our legitimate interest in service security and network integrity (Art. 6(1)(f)).</li>
          <li><strong>Infrastructure Resilience:</strong> Maintaining server access logs to protect against denial-of-service and malicious intrusion attempts — pursuant to our legitimate interest (Art. 6(1)(f)).</li>
          <li><strong>Compliance with Legal Obligations:</strong> Retaining necessary transaction and communication records to satisfy tax, accounting, and statutory civil disclosure requirements (Art. 6(1)(c)).</li>
        </ul>
        <div class="legal-stipulation">
          <strong>Statutory Covenant of Non-Commercialization:</strong> The Data Controller formally warrants that personal data collected through this website is never sold, leased, rented, monetized, or shared with third parties for commercial, advertising, or marketing purposes. Furthermore, the Data Controller does not execute automated decision-making or individual profiling pursuant to GDPR Article 22.
        </div>
      `
    },
    {
      num: '04',
      title: 'Retention Periods and Storage Limitations',
      content: `
        <p>We apply strict storage limitation criteria pursuant to GDPR Article 5(1)(e):</p>
        <ul class="legal-list">
          <li><strong>Consultation & Contact Records:</strong> Retained for a maximum period of <strong>twenty-four (24) months</strong> following the date of last correspondence, after which records are permanently purged or rendered completely anonymous, except where an active legal transaction, pre-contractual commitment, or pending dispute mandates extended retention under statutory limitation periods.</li>
          <li><strong>Server Access Logs:</strong> Retained for a maximum period of <strong>twelve (12) months</strong> exclusively for network security auditing and threat analysis.</li>
          <li><strong>Immediate Right of Erasure:</strong> Data subjects retain the right to demand expedited deletion of consultation records at any time, subject to statutory record-retention requirements under Hellenic law.</li>
        </ul>
      `
    },
    {
      num: '05',
      title: 'Recipients of Personal Data and Data Processors',
      content: `
        <p>Personal data is disclosed strictly on a need-to-know basis to authorised parties bound by formal confidentiality obligations:</p>
        <ul class="legal-list">
          <li><strong>Direct Corporate Infrastructure:</strong> Submissions are transmitted directly to our own database server situated in Frankfurt, Germany. No external form broker or intermediary marketing CRM receives your unencrypted submission.</li>
          <li><strong>Technical Infrastructure Providers:</strong> Google Ireland Ltd / Google LLC (Maps and Fonts), jsDelivr (CDN stylesheet delivery), and Net-FS / Sketchfab (multimedia architectural rendering).</li>
          <li><strong>Hosting Facilities:</strong> Dedicated European data center facilities located within the Federal Republic of Germany.</li>
          <li><strong>Legal & Statutory Advisers:</strong> Notaries, civil legal counsel, and judicial or regulatory authorities where disclosure is mandatory under Hellenic or EU legislation.</li>
        </ul>
        <p>All third-party data processors operate under binding data processing agreements executed pursuant to Article 28 GDPR.</p>
      `
    },
    {
      num: '06',
      title: 'Transfers of Personal Data Outside the European Economic Area',
      content: `
        <p>Certain technical infrastructure providers (specifically Google LLC, jsDelivr CDN, and Net-FS storage) may process technical protocol telemetry in jurisdictions situated outside the European Economic Area (EEA), primarily the United States. Where cross-border transfers occur, appropriate safeguards are strictly maintained pursuant to Chapter V of the GDPR, notably the <strong>EU-U.S. Data Privacy Framework</strong> and the European Commission&rsquo;s <strong>Standard Contractual Clauses (SCCs)</strong>. Copies of documentation verifying these transfer mechanisms are available upon formal written application.</p>
      `
    },
    {
      num: '07',
      title: 'Statutory Rights of Data Subjects (GDPR Chapter III)',
      content: `
        <p>Under Chapter III of Regulation (EU) 2016/679, data subjects possess the following enforceable statutory rights:</p>
        <ul class="legal-list">
          <li><strong>Right of Access (Article 15):</strong> Right to obtain confirmation as to whether personal data concerning you is processed, and to receive a structured disclosure copy.</li>
          <li><strong>Right to Rectification (Article 16):</strong> Right to obtain without undue delay the rectification of inaccurate personal data or completion of incomplete records.</li>
          <li><strong>Right to Erasure (&ldquo;Right to be Forgotten&rdquo;, Article 17):</strong> Right to obtain the erasure of personal data where statutory grounds apply.</li>
          <li><strong>Right to Restriction of Processing (Article 18):</strong> Right to restrict processing during disputes regarding accuracy or lawful grounds.</li>
          <li><strong>Right to Data Portability (Article 20):</strong> Right to receive personal data in a structured, commonly used, and machine-readable format.</li>
          <li><strong>Right to Object (Article 21):</strong> Right to object on grounds relating to your particular situation against processing founded upon legitimate interests.</li>
          <li><strong>Right to Withdraw Consent (Article 7(3)):</strong> Right to withdraw consent at any time without invalidating the lawfulness of processing conducted prior to withdrawal.</li>
        </ul>
        <p>To exercise any of the aforementioned rights, transmit a formal request to <strong>info@miracon.gr</strong>. Requests are processed free of charge within <strong>one (1) calendar month</strong> of verified receipt (extendable by up to two additional months where warranted by the complexity of the request, with timely notification).</p>
      `
    },
    {
      num: '08',
      title: 'Technical and Organisational Data Security Measures',
      content: `
        <p>We deploy robust technical and organisational security measures in accordance with GDPR Article 32: 256-bit TLS/HTTPS cryptographic transmission in transit, strict Content Security Policy (CSP) headers, Argon2id cryptographic password hashing, standalone server isolation, role-based access permissions, and periodic vulnerability reviews.</p>
      `
    },
    {
      num: '09',
      title: 'Protection of Minors',
      content: `
        <p>Our website and commercial real estate presentations are intended solely for individuals who have reached legal adulthood (18 years of age or older). We do not knowingly solicit or collect personal information from individuals under fifteen (15) years of age. Should you have cause to believe that a minor has submitted personal information, please notify us immediately for expedited erasure.</p>
      `
    },
    {
      num: '10',
      title: 'Periodic Amendments and Entry into Force',
      content: `
        <p>The Data Controller reserves the prerogative to revise this policy periodically to reflect statutory amendments, regulatory guidelines, or architectural updates. The prevailing and legally effective version, complete with its revision date, is permanently accessible at <strong>miracon.gr</strong>.</p>
      `
    }
  ]
};

// GREEK CONTENT DATA
const EL_DATA = {
  lang: 'el',
  title: 'Πολιτική Απορρήτου & Επίσημη Ενημέρωση Προστασίας Δεδομένων — MIRACON',
  brandSubtitle: 'Μονοπρόσωπη Ι.Κ.Ε. · Θεσσαλονίκη, Ελλάδα',
  docRef: 'MC-LEG-GDPR-2026-V2',
  legalBasisShort: 'Κανονισμός (ΕΕ) 2016/679 & Ν. 4624/2019',
  docTitle: 'ΠΟΛΙΤΙΚΗ ΑΠΟΡΡΗΤΟΥ & ΕΠΙΣΗΜΗ ΕΝΗΜΕΡΩΣΗ ΠΡΟΣΤΑΣΙΑΣ ΔΕΔΟΜΕΝΩΝ',
  docDesc: 'Συνταχθείσα κατ\' εφαρμογή των άρθρων 12, 13 και 14 του Κανονισμού (ΕΕ) 2016/679 του Ευρωπαϊκού Κοινοβουλίου και του Συμβουλίου (Γενικός Κανονισμός για την Προστασία Δεδομένων — ΓΚΠΔ) και του Ν. 4624/2019.',
  lblDate: 'Ημερομηνία Ισχύος',
  effectiveDate: '15 Σεπτεμβρίου 2026',
  lblVersion: 'Έκδοση',
  lblJurisdiction: 'Εποπτική Αρχή',
  jurisdictionVal: 'Αρχή Προστασίας Δεδομένων Προσωπικού Χαρακτήρα (ΑΠΔΠΧ)',
  lblController: 'Υπεύθυνος Επεξεργασίας',
  legalRep: 'Νόμιμος Εκπρόσωπος: Συμεών Ιωσηφίδης, Διαχειριστής',
  lblSeat: 'Έδρα & Στοιχεία Μητρώου',
  addressVal: 'Εγνατίας 84, 54630 Θεσσαλονίκη, Ελλάδα',
  lblInquiries: 'Επίσημη Επικοινωνία',
  summaryTitle: 'ΠΑΡΑΡΤΗΜΑ Α: ΣΥΝΟΠΤΙΚΟΣ ΠΙΝΑΚΑΣ ΕΠΕΞΕΡΓΑΣΙΑΣ ΔΕΔΟΜΕΝΩΝ (ΑΡΘΡΑ 13 & 14 ΓΚΠΔ)',
  colData: 'Κατηγορία Δεδομένων',
  colPurpose: 'Σκοπός Επεξεργασίας',
  colLegalBasis: 'Νομική Βάση (Άρθρο 6 ΓΚΠΔ)',
  colRetention: 'Χρόνος Διατήρησης',
  summaryRows: [
    ['Δεδομένα Φόρμας Επικοινωνίας', 'Απάντηση σε αιτήματα, παροχή τεχνικών προδιαγραφών και συμβουλευτικής ακινήτων', 'Άρθρο 6 παρ. 1 (α) Συγκατάθεση & (β) Προσυμβατικά μέτρα', '24 μήνες από την τελευταία επικοινωνία, κατόπιν διαγραφή'],
    ['Ασφάλεια & Μηχανισμός Anti-Spam', 'Προστασία φόρμας από αυτοματοποιημένα bots υποβολής και επιθέσεις CSRF', 'Άρθρο 6 παρ. 1 (στ) Έννομο συμφέρον ασφάλειας ιστοτόπου', 'Διάρκεια της τρέχουσας συνεδρίας περιήγησης'],
    ['Τεχνικά Αρχεία Καταγραφής (Server Logs)', 'Ασφάλεια διακομιστή, διάγνωση σφαλμάτων δικτύου και πρόληψη επιθέσεων DDoS', 'Άρθρο 6 παρ. 1 (στ) Έννομο συμφέρον επιχειρησιακής συνέχειας', 'Έως 12 μήνες σε ασφαλές περιβάλλον περιορισμένης πρόσβασης'],
    ['Συμμόρφωση & Νομικές Αξιώσεις', 'Υπεράσπιση νομικών αξιώσεων, φορολογική και λογιστική συμμόρφωση', 'Άρθρο 6 παρ. 1 (γ) Έννομη υποχρέωση & (στ) Νομική προστασία', 'Νόμιμος χρόνος παραγραφής (Αστικός Κώδικας)']
  ],
  cardTitle: '11. Στοιχεία Εταιρικής Ταυτότητας & Εποπτικής Προσφυγής',
  supervisoryTitle: 'Εποπτική & Ρυθμιστική Αρχή',
  clauses: [
    {
      num: '01',
      title: 'Υπεύθυνος Επεξεργασίας & Εταιρική Ταυτότητα',
      content: `
        <p>Τον ιστότοπο <strong>miracon.gr</strong> διαχειρίζεται η <strong>MIRACON ΜΟΝΟΠΡΟΣΩΠΗ ΙΔΙΩΤΙΚΗ ΚΕΦΑΛΑΙΟΥΧΙΚΗ ΕΤΑΙΡΕΙΑ</strong> (Μονοπρόσωπη Ι.Κ.Ε.) (&laquo;εμείς&raquo;), νομίμως συσταθείσα κατά το ελληνικό δίκαιο, με αριθμό ΓΕΜΗ <strong>172901704000</strong>, με καταστατική έδρα στη διεύθυνση <strong>Εγνατίας 84, 54630 Θεσσαλονίκη, Ελλάδα</strong>, νομίμως εκπροσωπούμενη από τον Διαχειριστή της <strong>Συμεών Ιωσηφίδη</strong>. ΑΦΜ: <strong>802235911</strong> (Α&rsquo; Δ.Ο.Υ. Θεσσαλονίκης). Ενεργούμε ως Υπεύθυνος Επεξεργασίας κατά την έννοια του άρθρου 4 σημείο 7 του Κανονισμού (ΕΕ) 2016/679 (ΓΚΠΔ).</p>
        <p>Για κάθε ζήτημα σχετικά με την παρούσα πολιτική ή για την άσκηση των νόμιμων δικαιωμάτων σας, επικοινωνήστε στο <strong>info@miracon.gr</strong>, τηλεφωνικά στο <strong>+30 695 534 0416</strong>, ή ταχυδρομικά στην καταστατική μας έδρα. Κατόπιν αξιολόγησης των δραστηριοτήτων επεξεργασίας βάσει του άρθρου 37 ΓΚΠΔ, η εταιρεία δεν υποχρεούται σε ορισμό Υπευθύνου Προστασίας Δεδομένων (DPO)· η εποπτεία ασκείται άμεσα από τη διοίκηση.</p>
      `
    },
    {
      num: '02',
      title: 'Κατηγορίες Προσωπικών Δεδομένων που Συλλέγονται',
      content: `
        <div class="sub-clause">
          <div class="sub-clause-title">2.1. Δεδομένα που Παρέχονται Οικειοθελώς από το Υποκείμενο</div>
          <p>Μέσω της ηλεκτρονικής φόρμας επικοινωνίας και ενδιαφέροντος, συλλέγουμε: το ονοματεπώνυμό σας, τον τηλεφωνικό αριθμό ή/και τη διεύθυνση ηλεκτρονικού ταχυδρομείου (email), το θέμα και το κείμενο του μηνύματός σας, καθώς και τη χρονική σήμανση αποδοχής της παρούσας πολιτικής. Η παροχή των στοιχείων αυτών είναι εθελοντική· ωστόσο, το ονοματεπώνυμο και τουλάχιστον ένα έγκυρο κανάλι επικοινωνίας είναι απαραίτητα για την απάντηση στο αίτημά σας.</p>
        </div>
        <div class="sub-clause">
          <div class="sub-clause-title">2.2. Τεχνικά Δεδομένα που Συλλέγονται Αυτόματα</div>
          <p>Κατά την είσοδο και πλοήγησή σας στον ιστότοπο, οι διακομιστές μας καταγράφουν αυτόματα βασικά τεχνικά στοιχεία πρωτοκόλλου HTTP: διεύθυνση IP του χρήστη, χρονική σήμανση του αιτήματος, μέθοδο HTTP και διεύθυνση URL, διεύθυνση παραπομπής (referrer header), στοιχεία προγράμματος περιήγησης και λειτουργικού συστήματος (user-agent), καθώς και τον κωδικό απόκρισης HTTP.</p>
        </div>
        <div class="sub-clause">
          <div class="sub-clause-title">2.3. Cookies, Τηλεμετρία & Τεχνικές Ενσωματώσεις Τρίτων</div>
          <p><strong>Ο παρών ιστότοπος δεν χρησιμοποιεί cookies πρώτου μέρους για ιχνηλάτηση, ανάλυση, κατάρτιση προφίλ ή διαφήμιση.</strong> Λειτουργεί εξ ολοκλήρου χωρίς διαφημιστικούς ιχνηλάτες συμπεριφοράς. Για την παροχή πλούσιου αρχιτεκτονικού περιεχομένου, συγκεκριμένες υπηρεσίες τρίτων λαμβάνουν την τεχνική σας διεύθυνση IP κατά τη φόρτωση των αρχείων:</p>
          <ul class="legal-list">
            <li><strong>Google Fonts & jsDelivr CDN:</strong> Γραμματοσειρές και στοιχεία μορφοποίησης που φορτώνονται από το πρόγραμμα περιήγησης για τη διασφάλιση ομοιόμορφης τυπογραφίας.</li>
            <li><strong>Google Maps:</strong> Διαδραστικοί χάρτες τοποθεσίας έργων στις σελίδες ακινήτων. Οι χάρτες ενεργοποιούνται κατά την κύλιση της οθόνης, οπότε η Google λαμβάνει τη διεύθυνση IP. Παρέχονται επίσης σύνδεσμοι προς εξωτερικές σελίδες πλοήγησης της Google.</li>
            <li><strong>360° Εικονικές Περιηγήσεις & 3D Μοντέλα:</strong> Ενσωματωμένες αρχιτεκτονικές περιηγήσεις μέσω της υποδομής Google Cloud (<em>storage.net-fs.com</em>) και 3D απεικονίσεις μέσω <em>sketchfab.com</em>, οι οποίες λαμβάνουν τη διεύθυνση IP αποκλειστικά για τη ροή πολυμέσων.</li>
          </ul>
        </div>
      `
    },
    {
      num: '03',
      title: 'Σκοποί Επεξεργασίας και Νομικές Βάσεις (Άρθρο 6 ΓΚΠΔ)',
      content: `
        <p>Η επεξεργασία των προσωπικών δεδομένων πραγματοποιείται αποκλειστικά σύμφωνα με το άρθρο 6 του Γενικού Κανονισμού (ΕΕ) 2016/679 (ΓΚΠΔ) επί των εξής νομικών βάσεων:</p>
        <ul class="legal-list">
          <li><strong>Διεκπεραίωση Αιτημάτων & Συμβουλευτική Ακινήτων:</strong> Για την απάντηση στα ερωτήματά σας, την αποστολή προδιαγραφών και τιμοκαταλόγων και τον συντονισμό επισκέψεων — βάσει της ρητής σας συγκατάθεσης (άρθρο 6 παρ. 1 (α)) και ενεργειών κατ' αίτησή σας πριν από τη σύναψη σύμβασης (άρθρο 6 παρ. 1 (β)).</li>
          <li><strong>Ασφάλεια Φόρμας & Προστασία Anti-Abuse:</strong> Για την αποτροπή αυτοματοποιημένης υποβολής ανεπιθύμητων μηνυμάτων (spam) και κυβερνοεπιθέσεων μέσω ιδιόκτητου ελέγχου διακομιστή — βάσει του εννόμου συμφέροντός μας για την ασφάλεια των συστημάτων (άρθρο 6 παρ. 1 (στ)).</li>
          <li><strong>Επιχειρησιακή Ασφάλεια Διακομιστών:</strong> Τήρηση τεχνικών αρχείων καταγραφής για την ανίχνευση και απόκρουση επιθέσεων άρνησης εξυπηρέτησης (DDoS) — βάσει του εννόμου συμφέροντός μας (άρθρο 6 παρ. 1 (στ)).</li>
          <li><strong>Συμμόρφωση με Έννομες Υποχρεώσεις:</strong> Διατήρηση απαραίτητων στοιχείων για τη συμμόρφωση με φορολογικές, λογιστικές και νομικές διατάξεις (άρθρο 6 παρ. 1 (γ)).</li>
        </ul>
        <div class="legal-stipulation">
          <strong>Ρητή Εγγύηση Μη Εμπορευματοποίησης:</strong> Ο Υπεύθυνος Επεξεργασίας εγγυάται ρητά ότι τα προσωπικά δεδομένα που συλλέγονται μέσω του παρόντος ιστοτόπου δεν πωλούνται, δεν εκμισθώνονται, δεν εμπορευματοποιούνται και δεν παραχωρούνται σε τρίτους για διαφημιστικούς ή εμπορικούς σκοπούς. Επιπλέον, δεν εφαρμόζεται αυτοματοποιημένη λήψη αποφάσεων ούτε κατάρτιση προφίλ (profiling) κατά το άρθρο 22 του ΓΚΠΔ.
        </div>
      `
    },
    {
      num: '04',
      title: 'Χρόνος Διατήρησης και Κριτήρια Διαγραφής',
      content: `
        <p>Εφαρμόζουμε αυστηρά κριτήρια περιορισμού της αποθήκευσης βάσει του άρθρου 5 παρ. 1 (ε) του ΓΚΠΔ:</p>
        <ul class="legal-list">
          <li><strong>Δεδομένα Επικοινωνίας & Φόρμας:</strong> Διατηρούνται για μέγιστο διάστημα <strong>είκοσι τεσσάρων (24) μηνών</strong> από την ημερομηνία της τελευταίας επικοινωνίας, μετά το πέρας των οποίων διαγράφονται οριστικά ή ανωνυμοποιούνται πλήρως, εκτός εάν υφίσταται ενεργή συμβατική σχέση ή εκκρεμής νομική αξίωση που απαιτεί επιμήκυνση της τήρησης.</li>
          <li><strong>Τεχνικά Αρχεία Καταγραφής (Server Logs):</strong> Διατηρούνται για μέγιστο διάστημα <strong>δώδεκα (12) μηνών</strong> αποκλειστικά για λόγους κυβερνοασφάλειας και ελέγχου υποδομών.</li>
          <li><strong>Άμεσο Δικαίωμα Διαγραφής:</strong> Έχετε το δικαίωμα να αιτηθείτε την άμεση διαγραφή των δεδομένων σας ανά πάσα στιγμή, υπό την επιφύλαξη των υποχρεωτικών εκ του νόμου περιόδων τήρησης.</li>
        </ul>
      `
    },
    {
      num: '05',
      title: 'Αποδέκτες Προσωπικών Δεδομένων και Εκτελούντες την Επεξεργασία',
      content: `
        <p>Τα προσωπικά δεδομένα κοινοποιούνται αποκλειστικά σε εξουσιοδοτημένους αποδέκτες που δεσμεύονται από αυστηρές συμβατικές ρήτρες εμπιστευτικότητας:</p>
        <ul class="legal-list">
          <li><strong>Ιδιόκτητη Υποδομή:</strong> Τα μηνύματα διαβιβάζονται απευθείας στον ασφαλή διακομιστή βάσης δεδομένων μας στη Φρανκφούρτη Γερμανίας. Κανένας εξωτερικός διαμεσολαβητής ή τρίτο διαφημιστικό CRM δεν λαμβάνει τα στοιχεία σας.</li>
          <li><strong>Πάροχοι Τεχνικής Υποδομής:</strong> Google Ireland Ltd / Google LLC (Χάρτες και Γραμματοσειρές), jsDelivr (CDN αρχείων στυλ) και Net-FS / Sketchfab (ροή αρχιτεκτονικών απεικονίσεων).</li>
          <li><strong>Υποδομή Φιλοξενίας:</strong> Αδειοδοτημένα ευρωπαϊκά κέντρα δεδομένων εντός της Ομοσπονδιακής Δημοκρατίας της Γερμανίας.</li>
          <li><strong>Επαγγελματικοί Σύμβουλοι & Δημόσιες Αρχές:</strong> Συμβολαιογράφοι, νομικοί σύμβουλοι, δικαστικές και δημόσιες αρχές όπου αυτό καθίσταται εκ του νόμου υποχρεωτικό.</li>
        </ul>
        <p>Όλοι οι εκτελούντες την επεξεργασία δεσμεύονται από συμβάσεις επεξεργασίας δεδομένων (DPA) σύμφωνα με το άρθρο 28 του ΓΚΠΔ.</p>
      `
    },
    {
      num: '06',
      title: 'Διαβιβάσεις Εκτός Ευρωπαϊκού Οικονομικού Χώρου (ΕΟΧ)',
      content: `
        <p>Ορισμένοι πάροχοι τεχνικών υπηρεσιών (όπως η Google LLC, το δίκτυο CDN jsDelivr και η Net-FS storage) ενδέχεται να επεξεργάζονται τεχνικά δεδομένα τηλεμετρίας εκτός του ΕΟΧ, κυρίως στις Ηνωμένες Πολιτείες. Σε περίπτωση τέτοιων διαβιβάσεων, διασφαλίζονται κατάλληλες εγγυήσεις βάσει του Κεφαλαίου V του ΓΚΠΔ, και ειδικότερα το <strong>Πλαίσιο Προστασίας Δεδομένων ΕΕ-ΗΠΑ (EU-U.S. Data Privacy Framework)</strong> καθώς και οι εγκεκριμένες <strong>Τυποποιημένες Συμβατικές Ρήτρες (SCCs)</strong> της Ευρωπαϊκής Επιτροπής. Αντίγραφα των εγγυήσεων παρέχονται κατόπιν γραπτού αιτήματος.</p>
      `
    },
    {
      num: '07',
      title: 'Νόμιμα Δικαιώματα των Υποκειμένων των Δεδομένων (Κεφάλαιο ΙΙΙ ΓΚΠΔ)',
      content: `
        <p>Σύμφωνα με το Κεφάλαιο ΙΙΙ του Κανονισμού (ΕΕ) 2016/679, διαθέτετε τα ακόλουθα νόμιμα δικαιώματα:</p>
        <ul class="legal-list">
          <li><strong>Δικαίωμα Πρόσβασης (Άρθρο 15):</strong> Επιβεβαίωση επεξεργασίας των δεδομένων σας και λήψη αντιγράφου αυτών.</li>
          <li><strong>Δικαίωμα Διόρθωσης (Άρθρο 16):</strong> Διόρθωση ανακριβών ή συμπλήρωση ελλιπών δεδομένων χωρίς αδικαιολόγητη καθυστέρηση.</li>
          <li><strong>Δικαίωμα Διαγραφής (&laquo;Δικαίωμα στη Λήθη&raquo;, Άρθρο 17):</strong> Διαγραφή των δεδομένων σας εφόσον συντρέχουν οι νόμιμες προϋποθέσεις.</li>
          <li><strong>Δικαίωμα Περιορισμού της Επεξεργασίας (Άρθρο 18):</strong> Περιορισμός χρήσης των δεδομένων σε περίπτωση αμφισβήτησης της ακρίβειάς τους.</li>
          <li><strong>Δικαίωμα στη Φορητότητα των Δεδομένων (Άρθρο 20):</strong> Λήψη των δεδομένων σας σε δομημένο, κοινώς χρησιμοποιούμενο και αναγνώσιμο από μηχανήματα μορφότυπο.</li>
          <li><strong>Δικαίωμα Εναντίωσης (Άρθρο 21):</strong> Εναντίωση στην επεξεργασία που βασίζεται σε έννομα συμφέροντα.</li>
          <li><strong>Δικαίωμα Ανάκλησης της Συγκατάθεσης (Άρθρο 7 παρ. 3):</strong> Ανάκληση συγκατάθεσης οποτεδήποτε, χωρίς να θίγεται η νομιμότητα της επεξεργασίας που προηγήθηκε.</li>
        </ul>
        <p>Για την άσκηση των δικαιωμάτων σας, αποστείλετε αίτημα στο <strong>info@miracon.gr</strong>. Απαντούμε δωρεάν εντός <strong>ενός (1) μηνός</strong> από την παραλαβή του αιτήματος (προθεσμία που δύναται να παραταθεί κατά δύο επιπλέον μήνες σε εξαιρετικά περίπλοκες περιπτώσεις, κατόπιν σχετικής ενημέρωσης).</p>
      `
    },
    {
      num: '08',
      title: 'Τεχνικά και Οργανωτικά Μέτρα Ασφαλείας Δεδομένων',
      content: `
        <p>Εφαρμόζουμε σύγχρονα τεχνικά και οργανωτικά μέτρα προστασίας κατά το άρθρο 32 του ΓΚΠΔ: κρυπτογραφημένη διακίνηση δεδομένων 256-bit TLS/HTTPS, αυστηρές επικεφαλίδες ασφαλείας Content Security Policy (CSP), κρυπτογραφική αποθήκευση κωδικών με χρήση αλγορίθμου Argon2id, απομονωμένο περιβάλλον διακομιστή (standalone Node server) και περιορισμό πρόσβασης βάσει ελαχίστων προνομίων.</p>
      `
    },
    {
      num: '09',
      title: 'Προστασία Ανηλίκων',
      content: `
        <p>Ο ιστότοπος και οι υπηρεσίες μας απευθύνονται αποκλειστικά σε ενήλικα φυσικά πρόσωπα. Δεν συλλέγουμε εν γνώσει μας δεδομένα από άτομα κάτω των 15 ετών. Εάν αντιληφθείτε ότι ανήλικος έχει καταχωρίσει προσωπικά δεδομένα, παρακαλούμε ειδοποιήστε μας άμεσα για την οριστική διαγραφή τους.</p>
      `
    },
    {
      num: '10',
      title: 'Περιοδικές Τροποποιήσεις & Έναρξη Ισχύος',
      content: `
        <p>Ο Υπεύθυνος Επεξεργασίας διατηρεί το δικαίωμα να επικαιροποιεί την παρούσα πολιτική όταν αυτό απαιτείται από νομοθετικές μεταβολές ή τεχνικές αναβαθμίσεις. Η εκάστοτε ισχύουσα έκδοση, με αναφορά στην ημερομηνία της, βρίσκεται μόνιμα αναρτημένη στον ιστότοπο <strong>miracon.gr</strong>.</p>
      `
    }
  ]
};

async function generatePdf(data, outputPath, headerText) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const html = buildHtml(data);
  await page.setContent(html, { waitUntil: 'networkidle' });

  await page.pdf({
    path: outputPath,
    format: 'A4',
    printBackground: true,
    margin: {
      top: '20mm',
      bottom: '20mm',
      left: '18mm',
      right: '18mm',
    },
    displayHeaderFooter: true,
    headerTemplate: `
      <div style="font-family: 'Times New Roman', Times, serif; font-size: 7pt; color: #555555; width: 100%; display: flex; justify-content: space-between; padding: 0 18mm; border-bottom: 0.5pt solid #888888; padding-bottom: 3px; text-transform: uppercase; letter-spacing: 0.04em;">
        <span>MIRACON &middot; STATUTORY CORPORATE POLICY</span>
        <span>${headerText}</span>
      </div>
    `,
    footerTemplate: `
      <div style="font-family: 'Times New Roman', Times, serif; font-size: 7pt; color: #555555; width: 100%; display: flex; justify-content: space-between; padding: 0 18mm; border-top: 0.5pt solid #888888; padding-top: 3px;">
        <span>miracon.gr &middot; Statutory Disclosure pursuant to Regulation (EU) 2016/679 (GDPR)</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>
    `,
  });

  await browser.close();
  console.log(`[PDF Generator] Successfully generated ${outputPath}`);
}

async function main() {
  const publicDocsDir = join(process.cwd(), 'public', 'documents');
  await mkdir(publicDocsDir, { recursive: true });

  const enPdfPath = join(publicDocsDir, 'privacy-policy-en.pdf');
  const elPdfPath = join(publicDocsDir, 'privacy-policy-el.pdf');

  console.log('[PDF Generator] Generating English Privacy Policy PDF...');
  await generatePdf(EN_DATA, enPdfPath, 'PRIVACY POLICY & DATA PROTECTION NOTICE');

  console.log('[PDF Generator] Generating Greek Privacy Policy PDF...');
  await generatePdf(EL_DATA, elPdfPath, 'ΠΟΛΙΤΙΚΗ ΑΠΟΡΡΗΤΟΥ & ΠΡΟΣΤΑΣΙΑΣ ΔΕΔΟΜΕΝΩΝ');

  const mediaRoot = process.env.MEDIA_ROOT || 'C:/Users/baira/AppData/Local/Temp/opencode/miracon-manual-media';
  try {
    const mediaDocsDir = join(mediaRoot, 'documents', 'privacy-policy');
    await mkdir(mediaDocsDir, { recursive: true });
    const { copyFile } = await import('node:fs/promises');
    await copyFile(enPdfPath, join(mediaDocsDir, 'privacy-policy-en.pdf'));
    await copyFile(elPdfPath, join(mediaDocsDir, 'privacy-policy-el.pdf'));
    console.log(`[PDF Generator] Copied PDFs to ${mediaDocsDir}`);
  } catch (err) {
    console.warn('[PDF Generator] Could not copy to MEDIA_ROOT:', err.message);
  }

  console.log('[PDF Generator] All PDFs generated successfully!');
}

main().catch(err => {
  console.error('[PDF Generator] Failed:', err);
  process.exit(1);
});
