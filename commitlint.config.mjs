export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 'sec' nao existe no config-conventional, mas e o tipo que o AGENTS.md
    // define para commit de seguranca. Os demais sao os do padrao.
    'type-enum': [
      2,
      'always',
      [
        'build',
        'chore',
        'ci',
        'docs',
        'feat',
        'fix',
        'perf',
        'refactor',
        'revert',
        'sec',
        'style',
        'test',
      ],
    ],
    // O corpo das mensagens deste repo e em portugues e explica decisao;
    // 100 colunas apertava demais.
    'body-max-line-length': [1, 'always', 120],
  },
};
