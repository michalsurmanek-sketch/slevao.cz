(() => {
  'use strict';
  window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(location.search);
    const issue = params.get('issue');
    const status = params.get('status');
    if (!issue && !status) return;

    const apply = () => {
      const issueFilter = document.getElementById('issueFilter');
      const statusFilter = document.getElementById('statusFilter');
      if (!issueFilter || !statusFilter) return false;
      if (issue && [...issueFilter.options].some((option) => option.value === issue)) issueFilter.value = issue;
      if (status && [...statusFilter.options].some((option) => option.value === status)) statusFilter.value = status;
      issueFilter.dispatchEvent(new Event('change', { bubbles:true }));
      statusFilter.dispatchEvent(new Event('change', { bubbles:true }));
      setTimeout(() => document.getElementById('table')?.scrollIntoView({ behavior:'smooth', block:'start' }), 180);
      return true;
    };

    if (apply()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (apply() || attempts > 20) clearInterval(timer);
    }, 150);
  });
})();
