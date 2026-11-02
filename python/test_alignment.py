import unittest
from types import SimpleNamespace
from alignment_worker import group_words, regions

class AlignmentTests(unittest.TestCase):
    def test_japanese_sentences_and_punctuation(self):
        sentences=[{'id':'1','text':'今日は晴れ。'},{'id':'2','text':'夜です！'}]
        words=[SimpleNamespace(text=t,start_time=s,end_time=e) for t,s,e in [('今日',1,1.4),('は',1.4,1.5),('晴れ',1.5,2),('夜',3,3.5),('です',3.5,4)]]
        values=group_words(sentences,words,5,20)
        self.assertEqual((values[0]['start'],values[0]['end']),(6,7))
        self.assertEqual((values[1]['start'],values[1]['end']),(8,9))
    def test_locked_sentence_forms_audio_boundaries(self):
        sentences=[{'id':'a','text':'朝'},{'id':'b','text':'昼','start':4,'end':6,'timingLocked':True},{'id':'c','text':'夜'}]
        segments=regions(sentences,10)
        self.assertEqual([(s,e) for _,s,e in segments],[(0,4),(6,10)])
        self.assertEqual([x[0]['id'] for x,_,_ in segments],['a','c'])
    def test_reject_bad_anchor(self):
        with self.assertRaises(ValueError):regions([{'id':'a','start':9,'end':11,'timingLocked':True}],10)
    def test_zero_length_not_fabricated(self):
        values=group_words([{'id':'a','text':'朝'}],[SimpleNamespace(text='朝',start_time=2,end_time=2)],0,10)
        self.assertEqual(values[0]['status'],'review')
        self.assertNotIn('start',values[0])
    def test_changed_token_text_rejected(self):
        with self.assertRaises(ValueError):group_words([{'id':'a','text':'朝'}],[SimpleNamespace(text='夜',start_time=2,end_time=3)],0,10)

if __name__=='__main__':unittest.main()
