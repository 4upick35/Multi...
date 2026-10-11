import {buildCaptchaHtml} from '../../src/components/captcha-html';

describe('buildCaptchaHtml', () => {
  const html = buildCaptchaHtml('test-key-1234', 'https://example.com');

  it('содержит sitekey и origin', () => {
    expect(html).toContain('test-key-1234');
    expect(html).toContain('https://example.com');
  });

  it('содержит обработку onerror скрипта', () => {
    expect(html).toContain('onerror');
    expect(html).toContain('Не удалось загрузить скрипт reCAPTCHA');
  });

  it('содержит текст про таймаут', () => {
    expect(html).toContain('Таймаут загрузки reCAPTCHA');
  });

  it('содержит все postMessage-типы', () => {
    expect(html).toContain("type:'success'");
    expect(html).toContain("type:'expired'");
    expect(html).toContain("type:'error'");
    expect(html).toContain("type:'loaded'");
  });

  describe('при пустом siteKey', () => {
    const emptyHtml = buildCaptchaHtml('', 'https://example.com');

    it('показывает сообщение об отсутствии ключа', () => {
      expect(emptyHtml).toContain('Не получен ключ reCAPTCHA (site_key пустой)');
    });

    it('не содержит вызов grecaptcha.render с ключом', () => {
      expect(emptyHtml).not.toContain("sitekey: ''");
      expect(emptyHtml).not.toContain('sitekey: ""');
      expect(emptyHtml).toContain('return;');
    });
  });
});
