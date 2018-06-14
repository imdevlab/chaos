package service

import (
	"net"

	"go.uber.org/zap"

	"github.com/cosmos-gg/meq/proto"
	"github.com/cosmos-gg/meq/proto/mqtt"
)

func publishOnline(from uint64, bk *Broker, msgs []*proto.PubMsg, broadcast bool) {
	topics := make(map[string][]*proto.PubMsg)
	for _, msg := range msgs {
		t := string(msg.Topic)
		topics[t] = append(topics[t], msg)
	}

	for t, msgs := range topics {
		var sesses []TopicSub
		var err error
		if broadcast {
			sesses, err = bk.subtrie.Lookup([]byte(t))
		} else {
			sesses, err = bk.subtrie.LookupExactly([]byte(t))
		}

		if err != nil {
			L.Info("Subtrie lookup error", zap.Error(err), zap.String("topic", t))
			continue
		}
		for _, sess := range sesses {
			if broadcast { // change the topic to the concrete subscrite topic
				for _, m := range msgs {
					m.Topic = sess.Topic
				}
			}

			if sess.Sub.Addr == bk.cluster.peer.name {
				if sess.Sub.Cid == from {
					continue
				}
				bk.RLock()
				c, ok := bk.clients[sess.Sub.Cid]
				bk.RUnlock()
				if !ok {
					bk.Lock()
					delete(bk.clients, sess.Sub.Cid)
					bk.Unlock()
				} else {
					c.msgSender <- msgs
				}
			} else {
				bk.router.route(sess.Sub, proto.PackPubBatch(msgs, proto.MSG_PUB_BATCH))
			}
		}
	}
}

func publishOne(conn net.Conn, ms []*proto.PubMsg) error {
	for _, m := range ms {
		msg := mqtt.Publish{
			Header: &mqtt.StaticHeader{
				QOS: 0,
			},
			Payload: proto.PackMsg(m),
		}
		msg.EncodeTo(conn)
	}

	return nil
}

func notifyOnline(bk *Broker, topic []byte, m []byte) {
	sesses, err := bk.subtrie.LookupExactly(topic)
	if err != nil {
		L.Info("Subtrie lookup error", zap.Error(err), zap.ByteString("topic", topic))
		return
	}

	for _, sess := range sesses {
		if sess.Sub.Addr == bk.cluster.peer.name {
			bk.RLock()
			c, ok := bk.clients[sess.Sub.Cid]
			bk.RUnlock()
			if !ok {
				bk.Lock()
				delete(bk.clients, sess.Sub.Cid)
				bk.Unlock()
			} else {
				notifyOne(c.conn, m)
			}
		} else {
			bk.router.route(sess.Sub, m)
		}
	}
}

func notifyOne(conn net.Conn, m []byte) error {
	msg := mqtt.Publish{
		Header: &mqtt.StaticHeader{
			QOS: 0,
		},
		Payload: m,
	}
	msg.EncodeTo(conn)

	return nil
}
