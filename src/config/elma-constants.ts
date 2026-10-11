// ---------------------------------------------------------------------------
// Таблица field_code → UUID для длинной формы ключей PUT /api/bpm/tasks/{uuid}.
// Снята из HAR16 (entry 1361) для шаблона
// customer_service.applications.execution_of_field_applications v24.
// При смене шаблона таблицу необходимо перепроверить / обновить.
// ---------------------------------------------------------------------------

export const EXECUTION_FIELD_IDS: Record<string, string> = {
  type_of_work: '662f468d-fe9a-435d-9b82-3623afd1bebe',
  planned_completion_date: '797e7d43-9bce-45d2-a8cc-408bcada7f25',
  until_what_date_should_repairs_be_agreed_with_buyer: '0b530900-bf45-41df-a7cc-a9079372344c',
  deadline_for_work: '39f10363-7369-45a6-87c8-75a7e81cc0b4',
  total_cost_of_repair_number: 'b515a163-1ec6-4cba-b999-bc8db7156751',
  total_cost_for_executor: 'c0a7b25f-7b3e-4509-862a-fbf46951299f',
  used_spare_parts_materials: 'b21a8f80-8c12-4cec-aabd-564485cc35ec',
  agreed_aditional_work: '42da8b6b-12f5-4c59-ba45-65de63dee3e2',
  materials_for_additional_work: '1401027d-971c-4d6f-bc57-a1884bd885fb',
  list_of_prohibited_spare_parts: 'a7d5dd03-0741-4fc1-a000-eadefd437ca7',
  session_confirmation_code: '1f9e0dc9-e2c9-4630-b797-53ebc366d8e6',
  send_sms_logs: '8fa92a92-5434-4798-b389-1775bffd4d8c',
  without_session_confirmation: '7302b10f-4eb6-462a-9598-c88d167a36a5',
  reason_for_lack_of_confirmation: 'c8b0697f-71f2-4dd1-9931-bf6b4c253fb6',
  decision_of_application: '871b8912-faa8-492c-9f5b-a7f0bc2e3d90',
  defect_category: '99a1ca8e-0978-4177-8e64-00a8be7e60eb',
  defect_has_been_confirmed: '6338d750-aae0-4b88-9ec3-77dfab2cd122',
  sn_of_technology: 'cb443c40-51fb-44dd-b2c0-e79321e9dfdd',
  work_order: '909d6728-6036-430f-8820-9895a97d3b74',
  result_of_work: '1859baf3-6cb0-47bf-ae03-793988ceffa7',
  technical_conclusion: 'cfb7fbf7-714e-4013-9436-0609e3131ce4',
  comment_on_request: 'f52746ec-df1b-4c6c-884e-87aa711e3260',
  files_to_request: 'bc9d8d34-1455-4fab-9555-a401aab16f85',
  type_of_request: '5a5a89ed-a396-4754-bed5-0cc386aa96aa',
  request_for_spare_parts: '16e6a3eb-23a3-4b30-b596-64990e96589c',
  shop_of_delivery: '7da572ae-a4b2-470a-bc3e-6841a29b2876',
  spare_parts_for_return: '45da1db3-3fce-4d90-a84e-46be1cd7af45',
  request_category: '1b048cfe-0004-4d1c-b747-6479eb4c6494',
  type_of_additional_work: '9f2c831c-6286-4b2d-a120-3fe886f7c470',
  with_spare_parts: 'ecdbbf6b-e0e0-4cc3-9c82-96c3631398fc',
  type_of_appeal: 'acc54fd0-03ab-4f0f-904b-d7e6d9d96d48',
  topic_of_appeal: '1bdc1b80-2c8f-49f4-bf73-683ffe7f426b',
  question_in_topic: 'd71bce40-5623-4200-8475-fe1ce98cca51',
  rerepair: '935b52d5-8130-4cae-8ea6-3a58a4fe4e12',
  contract: '0d600972-a06c-4f98-a50b-16b1e1dd618d',
  address: 'a833d265-c527-4ae0-a76e-0254f716c449',
  technic: '272f71e8-5c5d-45c9-b421-6e40c04dab29',
  technic_category: '5969a61a-7441-4ed0-8559-718d6267bacf',
  technic_brand: 'f2abe614-d751-4292-84ee-7b1680a8a487',
  service: '7584d63f-6a68-4559-98f5-2142a3c7065a',
  applications: 'aa2b7acb-b6c7-416b-888e-1eee7bdbdb04',
  customers_requirement: '9b4af2e7-20a5-4826-a25e-da7f8a13e0e9',
  problems_description: '93ee5bb1-617f-4a3c-8054-43fdffa94e67',
  appeals_authors_comment: '0f0dd845-0447-4140-a16d-bd2fdafb0cbe',
};

// ---------------------------------------------------------------------------
// Константы спецификации HAR21 (источник: tools/_har21_spec.md)
// ---------------------------------------------------------------------------

export const TEMPLATE_ID = '2f0b9e24-ab54-4e2c-bda7-f428c2a49961';
export const TEMPLATE_CODE = 'execution_of_field_applications';
export const FORM_CODE = 'form_d8f777cf-9686-4346-b353-4b9c07940777';
export const FORM_VERSION = 20;
/** Актуальная версия шаблона процесса «Исполнение заявок» (fallback, если задача не отдала __template.version). */
export const PROCESS_TEMPLATE_VERSION = 35;
export const EXIT_CONFIRM_VISIT = '877fac69-f4d9-4745-80fd-5c3dbfc8b8dd';
export const EXIT_DONE_CONFIRMED = 'eb83ef3d-0526-487f-9c50-17e00d162c82';

// Пространство имён длинных ключей для execution_of_field_applications
export const LONG_KEY_PREFIX =
  'customer_service.applications._process_execution_of_field_applications';
