const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const sampleCitations = [
  // Journal articles
  {
    id: 'citation_sample_journal_1',
    sessionId: null, // Will be set when creating demo paper
    sourceType: 'JOURNAL_ARTICLE',
    title: 'Deep Learning Approaches for Natural Language Processing: A Comprehensive Survey',
    authors: ['Smith, John A.', 'Johnson, Emily R.', 'Brown, Michael K.'],
    year: 2023,
    venue: 'Journal of Artificial Intelligence Research',
    volume: '67',
    issue: '2',
    pages: '145-189',
    doi: '10.5555/12345678',
    url: 'https://www.jair.org/index.php/jair/article/view/12345',
    citationKey: 'Smith2023a',
    bibtex: `@article{Smith2023a,
  title={Deep Learning Approaches for Natural Language Processing: A Comprehensive Survey},
  author={Smith, John A. and Johnson, Emily R. and Brown, Michael K.},
  journal={Journal of Artificial Intelligence Research},
  volume={67},
  number={2},
  pages={145--189},
  year={2023},
  doi={10.5555/12345678},
  url={https://www.jair.org/index.php/jair/article/view/12345}
}`,
  },
  {
    id: 'citation_sample_journal_2',
    sessionId: null,
    sourceType: 'JOURNAL_ARTICLE',
    title: 'Evaluating Large Language Models: A Framework for Systematic Assessment',
    authors: ['Chen, Wei', 'Zhang, Li', 'Liu, Peng'],
    year: 2023,
    venue: 'Nature Machine Intelligence',
    volume: '5',
    issue: '8',
    pages: '845-858',
    doi: '10.1038/s42256-023-00714-9',
    url: 'https://www.nature.com/articles/s42256-023-00714-9',
    citationKey: 'Chen2023b',
    bibtex: `@article{Chen2023b,
  title={Evaluating Large Language Models: A Framework for Systematic Assessment},
  author={Chen, Wei and Zhang, Li and Liu, Peng},
  journal={Nature Machine Intelligence},
  volume={5},
  number={8},
  pages={845--858},
  year={2023},
  doi={10.1038/s42256-023-00714-9},
  url={https://www.nature.com/articles/s42256-023-00714-9}
}`,
    tags: ['LLM evaluation', 'benchmarking', 'AI assessment']
  },
  // Conference papers
  {
    id: 'citation_sample_conference_1',
    sessionId: null,
    sourceType: 'CONFERENCE_PAPER',
    title: 'Attention Is All You Need',
    authors: ['Vaswani, Ashish', 'Shazeer, Noam', 'Parmar, Niki', 'Uszkoreit, Jakob', 'Jones, Llion', 'Gomez, Aidan N.', 'Kaiser, Lukasz', 'Polosukhin, Illia'],
    year: 2017,
    venue: 'Proceedings of the 31st International Conference on Neural Information Processing Systems',
    pages: '5998-6008',
    url: 'https://papers.nips.cc/paper/7181-attention-is-all-you-need',
    citationKey: 'Vaswani2017',
    bibtex: `@inproceedings{Vaswani2017,
  title={Attention Is All You Need},
  author={Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob and Jones, Llion and Gomez, Aidan N. and Kaiser, Lukasz and Polosukhin, Illia},
  booktitle={Proceedings of the 31st International Conference on Neural Information Processing Systems},
  pages={5998--6008},
  year={2017},
  url={https://papers.nips.cc/paper/7181-attention-is-all-you-need}
}`,
    tags: ['transformers', 'attention', 'neural networks']
  },
  // Books
  {
    id: 'citation_sample_book_1',
    sessionId: null,
    sourceType: 'BOOK',
    title: 'Deep Learning',
    authors: ['Goodfellow, Ian', 'Bengio, Yoshua', 'Courville, Aaron'],
    year: 2016,
    publisher: 'MIT Press',
    isbn: '978-0262035613',
    url: 'https://www.deeplearningbook.org/',
    citationKey: 'Goodfellow2016',
    bibtex: `@book{Goodfellow2016,
  title={Deep Learning},
  author={Goodfellow, Ian and Bengio, Yoshua and Courville, Aaron},
  publisher={MIT Press},
  year={2016},
  isbn={978-0262035613},
  url={https://www.deeplearningbook.org/}
}`,
    tags: ['deep learning', 'textbook', 'theory']
  },
  // Website/Reports
  {
    id: 'citation_sample_website_1',
    sessionId: null,
    sourceType: 'WEBSITE',
    title: 'GPT-4 Technical Report',
    authors: ['OpenAI'],
    year: 2023,
    venue: 'OpenAI',
    url: 'https://cdn.openai.com/papers/gpt-4.pdf',
    citationKey: 'OpenAI2023',
    bibtex: `@misc{OpenAI2023,
  title={GPT-4 Technical Report},
  author={OpenAI},
  year={2023},
  url={https://cdn.openai.com/papers/gpt-4.pdf}
}`,
    tags: ['GPT-4', 'large language models', 'technical report']
  },
  // Thesis
  {
    id: 'citation_sample_thesis_1',
    sessionId: null,
    sourceType: 'THESIS',
    title: 'Neural Machine Translation by Jointly Learning to Align and Translate',
    authors: ['Bahdanau, Dzmitry'],
    year: 2014,
    venue: 'Université de Montréal',
    url: 'https://arxiv.org/abs/1409.0473',
    citationKey: 'Bahdanau2014',
    bibtex: `@phdthesis{Bahdanau2014,
  title={Neural Machine Translation by Jointly Learning to Align and Translate},
  author={Bahdanau, Dzmitry},
  school={Universit{\'e} de Montr{\'e}al},
  year={2014},
  url={https://arxiv.org/abs/1409.0473}
}`,
    tags: ['neural machine translation', 'attention', 'PhD thesis']
  },
  // Patents (for completeness)
  {
    id: 'citation_sample_patent_1',
    sessionId: null,
    sourceType: 'PATENT',
    title: 'System and Method for Neural Network Training',
    authors: ['Smith, John A.', 'Johnson, Emily R.'],
    year: 2022,
    venue: 'US Patent',
    pages: 'US-2022-0123456-A1',
    url: 'https://patents.google.com/patent/US20220123456A1/',
    citationKey: 'Smith2022',
    bibtex: `@patent{Smith2022,
  title={System and Method for Neural Network Training},
  author={Smith, John A. and Johnson, Emily R.},
  year={2022},
  number={US-2022-0123456-A1},
  url={https://patents.google.com/patent/US20220123456A1/}
}`,
    tags: ['patent', 'neural networks', 'distributed training']
  },
  // Preprint/ArXiv
  {
    id: 'citation_sample_arxiv_1',
    sessionId: null,
    sourceType: 'WORKING_PAPER',
    title: 'Language Models are Few-Shot Learners',
    authors: ['Brown, Tom', 'Mann, Benjamin', 'Ryder, Nick', 'Subbiah, Melanie', 'Kaplan, Jared D.', 'Dhariwal, Prafulla', 'Neelakantan, Arvind', 'Shyam, Pranav', 'Sastry, Girish', 'Askell, Amanda', 'Agarwal, Sandhini', 'Herbert-Voss, Ariel', 'Krueger, Gretchen', 'Henighan, Tom', 'Child, Rewon', 'Ramesh, Aditya', 'Ziegler, Daniel', 'Wu, Jeffrey', 'Winter, Clemens', 'Hesse, Chris', 'Chen, Mark', 'Sigler, Eric', 'Litwin, Mateusz', 'Gray, Scott', 'Chess, Benjamin', 'Clark, Jack', 'Berner, Christopher', 'McCandlish, Sam', 'Radford, Alec', 'Sutskever, Igor', 'Amodei, Dario'],
    year: 2020,
    venue: 'arXiv preprint arXiv:2005.14165',
    url: 'https://arxiv.org/abs/2005.14165',
    citationKey: 'Brown2020',
    bibtex: `@article{Brown2020,
  title={Language Models are Few-Shot Learners},
  author={Brown, Tom and Mann, Benjamin and Ryder, Nick and Subbiah, Melanie and Kaplan, Jared D. and Dhariwal, Prafulla and Neelakantan, Arvind and Shyam, Pranav and Sastry, Girish and Askell, Amanda and Agarwal, Sandhini and Herbert-Voss, Ariel and Krueger, Gretchen and Henighan, Tom and Child, Rewon and Ramesh, Aditya and Ziegler, Daniel and Wu, Jeffrey and Winter, Clemens and Hesse, Chris and Chen, Mark and Sigler, Eric and Litwin, Mateusz and Gray, Scott and Chess, Benjamin and Clark, Jack and Berner, Christopher and McCandlish, Sam and Radford, Alec and Sutskever, Igor and Amodei, Dario},
  journal={arXiv preprint arXiv:2005.14165},
  year={2020},
  url={https://arxiv.org/abs/2005.14165}
}`,
    tags: ['GPT-3', 'few-shot learning', 'large language models']
  },
  // Additional Journal Articles for 10+ requirement
  {
    id: 'citation_sample_journal_3',
    sessionId: null,
    sourceType: 'JOURNAL_ARTICLE',
    title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
    authors: ['Devlin, Jacob', 'Chang, Ming-Wei', 'Lee, Kenton', 'Toutanova, Kristina'],
    year: 2019,
    venue: 'Proceedings of NAACL-HLT',
    pages: '4171-4186',
    url: 'https://aclanthology.org/N19-1423/',
    citationKey: 'Devlin2019',
    bibtex: `@inproceedings{Devlin2019,
  title={BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding},
  author={Devlin, Jacob and Chang, Ming-Wei and Lee, Kenton and Toutanova, Kristina},
  booktitle={Proceedings of NAACL-HLT},
  pages={4171--4186},
  year={2019},
  url={https://aclanthology.org/N19-1423/}
}`,
    tags: ['BERT', 'transformers', 'pre-training', 'NLP']
  },
  {
    id: 'citation_sample_journal_4',
    sessionId: null,
    sourceType: 'JOURNAL_ARTICLE',
    title: 'ImageNet Classification with Deep Convolutional Neural Networks',
    authors: ['Krizhevsky, Alex', 'Sutskever, Ilya', 'Hinton, Geoffrey E.'],
    year: 2012,
    venue: 'Advances in Neural Information Processing Systems',
    volume: '25',
    pages: '1097-1105',
    url: 'https://papers.nips.cc/paper/2012/hash/c399862d3b9d6b76c8436e924a68c45b-Abstract.html',
    citationKey: 'Krizhevsky2012',
    bibtex: `@inproceedings{Krizhevsky2012,
  title={ImageNet Classification with Deep Convolutional Neural Networks},
  author={Krizhevsky, Alex and Sutskever, Ilya and Hinton, Geoffrey E.},
  booktitle={Advances in Neural Information Processing Systems},
  volume={25},
  pages={1097--1105},
  year={2012},
  url={https://papers.nips.cc/paper/2012/hash/c399862d3b9d6b76c8436e924a68c45b-Abstract.html}
}`,
    tags: ['CNN', 'deep learning', 'image classification', 'AlexNet']
  },
  {
    id: 'citation_sample_journal_5',
    sessionId: null,
    sourceType: 'JOURNAL_ARTICLE',
    title: 'Dropout: A Simple Way to Prevent Neural Networks from Overfitting',
    authors: ['Srivastava, Nitish', 'Hinton, Geoffrey', 'Krizhevsky, Alex', 'Sutskever, Ilya', 'Salakhutdinov, Ruslan'],
    year: 2014,
    venue: 'Journal of Machine Learning Research',
    volume: '15',
    issue: '1',
    pages: '1929-1958',
    url: 'https://jmlr.org/papers/v15/srivastava14a.html',
    citationKey: 'Srivastava2014',
    bibtex: `@article{Srivastava2014,
  title={Dropout: A Simple Way to Prevent Neural Networks from Overfitting},
  author={Srivastava, Nitish and Hinton, Geoffrey and Krizhevsky, Alex and Sutskever, Ilya and Salakhutdinov, Ruslan},
  journal={Journal of Machine Learning Research},
  volume={15},
  number={1},
  pages={1929--1958},
  year={2014},
  url={https://jmlr.org/papers/v15/srivastava14a.html}
}`,
    tags: ['dropout', 'regularization', 'neural networks', 'overfitting']
  }
];

async function seedSampleCitations() {
  try {
    console.log('Seeding sample citations...');

    // Get the super admin user for citations
    const superAdmin = await prisma.user.findFirst({
      where: { roles: { has: 'SUPER_ADMIN' } }
    });

    if (!superAdmin) {
      throw new Error('Super admin user not found. Please run seed scripts first.');
    }

    // Create a demo project if it doesn't exist
    const demoProject = await prisma.project.upsert({
      where: { id: 'demo_project' },
      update: {},
      create: {
        id: 'demo_project',
        name: 'Demo Paper Project',
        userId: superAdmin.id
      }
    });

    // Create a dummy patent for the demo session (required by schema)
    const demoPatent = await prisma.patent.upsert({
      where: { id: 'demo_paper_patent' },
      update: {},
      create: {
        id: 'demo_paper_patent',
        title: 'Demo Paper Patent Placeholder',
        projectId: demoProject.id,
        createdBy: superAdmin.id
      }
    });

    // Create a demo session for the citations
    const demoSession = await prisma.draftingSession.upsert({
      where: { id: 'demo_paper_session' },
      update: {},
      create: {
        id: 'demo_paper_session',
        patentId: demoPatent.id,
        userId: superAdmin.id,
        tenantId: superAdmin.tenantId,
        paperTypeId: 'paper_type_journal_article',
        citationStyleId: 'citation_style_apa7',
        status: 'ANNEXURE_DRAFT',
        literatureReviewStatus: 'COMPLETED',
        targetWordCount: 6000
      }
    });

    console.log(`✓ Created demo session: ${demoSession.id}`);

    // Seed citations
    for (const citation of sampleCitations) {
      const citationData = {
        ...citation,
        sessionId: demoSession.id
      };

      await prisma.citation.upsert({
        where: { id: citation.id },
        update: citationData,
        create: citationData
      });
      console.log(`✓ Seeded citation: ${citation.citationKey} - ${citation.title.substring(0, 50)}...`);
    }

    console.log('\nSample citation seeding completed!');
    console.log(`Created ${sampleCitations.length} sample citations for demo session: ${demoSession.id}`);

  } catch (error) {
    console.error('Error seeding sample citations:', error);
  } finally {
    await prisma.$disconnect();
  }
}

seedSampleCitations();
